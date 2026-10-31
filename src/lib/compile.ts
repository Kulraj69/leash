import {
  defaultPolicy,
  formatNear,
  isAccountId,
  isMethod,
  matchesReceiver,
  parseNear,
  type Policy,
} from "./policy";
const amount = "(\\d+(?:\\.\\d{1,24})?)";
function clock(text: string): number | null {
  const m = text.match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)$/i);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return null;
  return (
    ((Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)) * 60 +
    Number(m[2] ?? 0)
  );
}
function list(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\s+and\s+|\s*,\s*/i)
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ].sort();
}

/** Entire clauses must match. Unrecognized text is never silently treated as protection. */
export function compile(text: string): {
  policy: Policy;
  unparsed: string[];
  notes: string[];
} {
  const policy = defaultPolicy();
  const unparsed: string[] = [];
  const fragments = text
    .trim()
    .split(
      /;|\n|\.\s+(?=[a-z])|,\s*(?=(?:max|never|only|ask|no more|block)\b)|\s+and\s+(?=(?:max|never|only|ask|no more|block)\b)/i,
    );
  for (const fragment of fragments) {
    const s = fragment.trim().replace(/[.!]$/, "");
    if (!s) continue;
    let m: RegExpMatchArray | null;
    try {
      if (
        (m = s.match(
          new RegExp(`^(?:max|maximum) ${amount} NEAR (?:a|per) day$`, "i"),
        ))
      )
        policy.dailyBudgetYocto = parseNear(m[1]);
      else if (
        (m = s.match(
          new RegExp(
            `^(?:never more than|max) ${amount} NEAR per (?:payment|transaction)$`,
            "i",
          ),
        ))
      )
        policy.perTxCapYocto = parseNear(m[1]);
      else if ((m = s.match(new RegExp(`^ask me above ${amount} NEAR$`, "i"))))
        policy.askHumanAboveYocto = parseNear(m[1]);
      else if (
        (m = s.match(/^no more than (\d{1,5}) payments (?:an|per) hour$/i)) &&
        Number(m[1]) <= 10000
      )
        policy.maxTxPerHour = Number(m[1]);
      else if ((m = s.match(/^(only pay|block|never pay) (.+)$/i))) {
        const receivers = list(m[2]);
        if (
          !receivers.length ||
          receivers.some(
            (r) => !isAccountId(r.startsWith("*.") ? r.slice(2) : r),
          )
        )
          throw new Error();
        if (m[1].toLowerCase() === "only pay") policy.allowlist = receivers;
        else
          policy.blockedReceivers = [
            ...new Set([...policy.blockedReceivers, ...receivers]),
          ].sort();
      } else if ((m = s.match(/^only between (.+) and (.+)$/i))) {
        const start = clock(m[1]),
          end = clock(m[2]);
        if (start === null || end === null || start === end) throw new Error();
        policy.activeHours = { start, end, timezone: "Asia/Kolkata" };
      } else if ((m = s.match(/^only methods (.+) on ([\w.*-]+)$/i))) {
        const methods = list(m[1]);
        if (
          !isAccountId(m[2].replace(/^\*\./, "")) ||
          !methods.length ||
          methods.some((x) => !isMethod(x))
        )
          throw new Error();
        policy.allowedMethods[m[2]] = methods;
      } else if ((m = s.match(/^only tokens (.+)$/i))) {
        const tokens = list(m[1]).map((t) =>
          t.toUpperCase() === "NEAR" ? "NEAR" : t,
        );
        if (
          !tokens.length ||
          tokens.some((t) => t !== "NEAR" && !isAccountId(t))
        )
          throw new Error();
        policy.allowedTokens = tokens;
      } else unparsed.push(fragment.trim());
    } catch {
      unparsed.push(fragment.trim());
    }
  }
  return {
    policy,
    unparsed,
    notes: [
      "Defaults: 2 NEAR/day, 0.5/payment, ask above 0.3, 5/hour, NEAR only, no receivers until specified. All hours are IST; daily budgets reset at midnight IST.",
      "A later recognized clause replaces the same setting; block clauses accumulate. Missing method rules permit all methods. Review the compiled policy before use.",
    ],
  };
}
export type AccessKeySpec = {
  receiver_id: string;
  method_names: string[];
  allowance: string;
  command: string;
};
export function compileAccessKey(policy: Policy): {
  keys: AccessKeySpec[];
  notes: string[];
} {
  const notes = [
    "Preview only. Leash never runs these commands. Replace YOUR_ACCOUNT.testnet and YOUR_PUBLIC_KEY with your account and an existing public key; use a distinct key for each receiver.",
    "Allowance limits cumulative gas fees, not transferred value or a daily budget. This preview uses the daily budget as a gas-allowance suggestion; choose an appropriate gas cap before running it.",
    "Function-call keys cannot make native transfers or attach deposits. Standard ft_transfer needs a 1-yocto deposit, so this key cannot directly authorize it.",
    "Daily resets, per-payment caps, hourly limits, human approval, token rules, argument checks and time windows require a trusted runtime or on-chain enforcement beyond an access key.",
  ];
  if (policy.allowlist === null)
    notes.push(
      "An unrestricted receiver policy cannot fit one function-call key. Specify exact receivers first.",
    );
  if ((policy.allowlist?.length ?? 0) > 1)
    notes.push(
      "One receiver per function-call key: create one key per receiver. Splitting keys does not enforce a shared budget.",
    );
  const keys: AccessKeySpec[] = [];
  for (const receiver of policy.allowlist ?? []) {
    if (receiver.startsWith("*.")) {
      notes.push(
        `Wildcard ${receiver} cannot be encoded. Enumerate exact accounts and create one key per receiver.`,
      );
      continue;
    }
    if (policy.blockedReceivers.some((p) => matchesReceiver(receiver, p)))
      continue;
    const matching = Object.entries(policy.allowedMethods).filter(([p]) =>
      matchesReceiver(receiver, p),
    );
    const methods = matching.length
      ? matching
          .map(([, m]) => m)
          .reduce((a, b) => a.filter((m) => b.includes(m)))
      : [];
    if (matching.length && !methods.length) {
      notes.push(
        `No permitted methods on ${receiver}; no key emitted. An empty on-chain method list would permit ALL methods.`,
      );
      continue;
    }
    if (!matching.length)
      notes.push(
        `${receiver}: empty method_names means ALL contract methods. Add an explicit method rule to reduce authority.`,
      );
    if (policy.dailyBudgetYocto === null) {
      notes.push(
        `${receiver}: no finite allowance available; set a budget before generating a key.`,
      );
      continue;
    }
    const allowance = policy.dailyBudgetYocto.toString();
    const command = `near account add-key YOUR_ACCOUNT.testnet grant-function-call-access --allowance '${formatNear(policy.dailyBudgetYocto)} NEAR' --receiver-account-id '${receiver}' --method-names '${methods.join(",")}' use-manually-provided-public-key YOUR_PUBLIC_KEY network-config testnet sign-with-keychain send`;
    keys.push({
      receiver_id: receiver,
      method_names: [...methods].sort(),
      allowance,
      command,
    });
  }
  if (!keys.length)
    notes.push(
      "No key generated. Supply at least one exact, unblocked receiver and a finite allowance.",
    );
  return { keys, notes };
}

