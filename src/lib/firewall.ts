import {
  formatNear,
  isAccountId,
  isMethod,
  matchesReceiver,
  MAX_U128,
  record,
  yocto,
  type Policy,
} from "./policy";
export type Action = {
  kind: "transfer" | "ft_transfer" | "function_call" | "intent_swap";
  receiver: string;
  amountYocto: bigint;
  method?: string;
  token?: string;
  memo?: string;
  args?: unknown;
};
export type LedgerEntry = { amountYocto: bigint; timestamp: number };
export type Ledger = readonly LedgerEntry[];
export type Verdict = "ALLOW" | "ASK_HUMAN" | "BLOCK";
export type Evaluation = {
  verdict: Verdict;
  firedRules: string[];
  receipt: string[];
  remainingBudget: bigint | null;
};

export function parseAction(value: unknown): Action {
  const a = record(value);
  if (
    !["transfer", "ft_transfer", "function_call", "intent_swap"].includes(
      String(a.kind),
    )
  )
    throw new Error("Choose a supported action kind.");
  if (
    typeof a.receiver !== "string" ||
    !a.receiver.length ||
    a.receiver.length > 128
  )
    throw new Error("Receiver must be 1–128 characters.");
  for (const key of ["memo", "method", "token"])
    if (
      a[key] !== undefined &&
      (typeof a[key] !== "string" ||
        String(a[key]).length > (key === "memo" ? 1000 : 128))
    )
      throw new Error(`Invalid ${key}.`);
  return {
    kind: a.kind as Action["kind"],
    receiver: a.receiver,
    amountYocto: yocto(a.amountYocto),
    ...(a.method !== undefined ? { method: a.method as string } : {}),
    ...(a.token !== undefined ? { token: a.token as string } : {}),
    ...(a.memo !== undefined ? { memo: a.memo as string } : {}),
    ...(a.args !== undefined ? { args: a.args } : {}),
  };
}
// One insertion, deletion or substitution. Exact allowlisted accounts are exempt.
export function oneEditAway(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length <= b.length) j++;
    if (a.length >= b.length) i++;
  }
  return edits + Number(i < a.length || j < b.length) === 1;
}
export function istDay(now: number): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}
function inHours(
  now: number,
  hours: NonNullable<Policy["activeHours"]>,
): boolean {
  const t = new Date(now + 330 * 60_000);
  const m = t.getUTCHours() * 60 + t.getUTCMinutes();
  return hours.start < hours.end
    ? m >= hours.start && m < hours.end
    : m >= hours.start || m < hours.end;
}
/** Pure simulation: no mutation, network, signing, or floating-point currency arithmetic. */
export function evaluate(
  action: Action,
  policy: Policy,
  ledger: Ledger,
  now: number,
): Evaluation {
  if (!Number.isFinite(now)) throw new Error("Invalid evaluation time.");
  const blocks: string[] = [];
  const reasons: string[] = [];
  const block = (rule: string, reason: string) => {
    blocks.push(rule);
    reasons.push(reason);
  };
  const day = istDay(now);
  const recent = ledger.filter(
    (e) => e.timestamp <= now && e.timestamp > now - 3_600_000,
  );
  const spent = ledger
    .filter((e) => e.timestamp <= now && istDay(e.timestamp) === day)
    .reduce((s, e) => s + e.amountYocto, 0n);
  const remaining =
    policy.dailyBudgetYocto === null
      ? null
      : policy.dailyBudgetYocto > spent
        ? policy.dailyBudgetYocto - spent
        : 0n;
  if (action.amountYocto < 0n || action.amountYocto > MAX_U128)
    block("INVALID_AMOUNT", "Amount must be an unsigned u128 yoctoNEAR value.");
  if (/[^\x00-\x7F]/.test(action.receiver))
    block(
      "UNICODE_RECEIVER",
      "Non-ASCII receiver: possible Unicode lookalike account.",
    );
  else if (!isAccountId(action.receiver))
    block("INVALID_RECEIVER", "Receiver is not a valid NEAR account ID.");
  const authorized =
    policy.allowlist === null ||
    policy.allowlist.some((p) => matchesReceiver(action.receiver, p));
  if (
    !authorized &&
    policy.allowlist?.some(
      (p) => !p.startsWith("*.") && oneEditAway(action.receiver, p),
    )
  )
    block(
      "LOOKALIKE_RECEIVER",
      "Receiver differs by one character from an allowlisted account.",
    );
  const raw = `${action.memo ?? ""} ${JSON.stringify(action.args ?? {})}`;
  const normalized = raw
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (
    /ignore\s+(?:(?:all|the)\s+)?(?:previous|prior|rules)|send\s+(?:all|everything)|override\s+(?:policy|rules)|bypass\s+(?:policy|firewall)|system\s*prompt/i.test(
      normalized,
    )
  )
    block(
      "PROMPT_INJECTION",
      "Instruction override or wallet-draining marker in memo/args.",
    );
  if (
    action.args &&
    typeof action.args === "object" &&
    !Array.isArray(action.args)
  ) {
    const args = action.args as Record<string, unknown>;
    for (const field of [
      "receiver",
      "receiver_id",
      "recipient",
      "recipient_id",
    ])
      if (args[field] !== undefined && args[field] !== action.receiver)
        block(
          "ARGUMENT_RECEIVER",
          "Embedded recipient differs from the evaluated receiver; normalize actions first.",
        );
  }
  if (policy.blockedReceivers.some((p) => matchesReceiver(action.receiver, p)))
    block(
      "BLOCKED_RECEIVER",
      "Receiver is explicitly blocked (block rules take precedence).",
    );
  if (!authorized)
    block("ALLOWLIST", "Receiver is outside the allowed accounts.");
  const token = action.token ?? "NEAR";
  if (action.kind === "transfer" && token !== "NEAR")
    block("TOKEN_KIND", "A native transfer must use NEAR.");
  if (
    action.kind === "ft_transfer" &&
    (!action.token || action.token === "NEAR")
  )
    block("TOKEN_REQUIRED", "An FT proposal must name its token contract.");
  if (policy.allowedTokens !== null && !policy.allowedTokens.includes(token))
    block("TOKEN", "Token is not allowed by this policy.");
  const method =
    action.kind === "ft_transfer"
      ? "ft_transfer"
      : action.kind === "intent_swap"
        ? "intent_swap"
        : action.kind === "function_call"
          ? action.method
          : "__native_transfer__";
  if (
    action.kind === "function_call" &&
    (!action.method || !isMethod(action.method))
  )
    block("METHOD_REQUIRED", "Function calls require a valid method name.");
  const constraints = Object.entries(policy.allowedMethods).filter(([p]) =>
    matchesReceiver(action.receiver, p),
  );
  if (constraints.some(([, methods]) => !method || !methods.includes(method)))
    block("METHOD", "Action is outside this receiver's permitted methods.");
  if (
    policy.perTxCapYocto !== null &&
    action.amountYocto > policy.perTxCapYocto
  )
    block(
      "PER_TX_CAP",
      `Payment exceeds ${formatNear(policy.perTxCapYocto)} NEAR per transaction.`,
    );
  if (remaining !== null && action.amountYocto > remaining)
    block(
      "DAILY_BUDGET",
      `Payment exceeds the ${formatNear(remaining)} NEAR remaining today (IST).`,
    );
  if (policy.maxTxPerHour !== null && recent.length >= policy.maxTxPerHour)
    block(
      "HOURLY_RATE",
      `Limit of ${policy.maxTxPerHour} allowed actions per rolling hour reached.`,
    );
  if (policy.activeHours && !inHours(now, policy.activeHours))
    block(
      "ACTIVE_HOURS",
      "Outside the permitted IST window (start inclusive, end exclusive).",
    );
  const ask =
    policy.askHumanAboveYocto !== null &&
    action.amountYocto > policy.askHumanAboveYocto;
  const verdict: Verdict = blocks.length
    ? "BLOCK"
    : ask
      ? "ASK_HUMAN"
      : "ALLOW";
  const firedRules = blocks.length
    ? [...new Set(blocks)]
    : ask
      ? ["HUMAN_THRESHOLD"]
      : ["POLICY_PASSED"];
  const remainingBudget =
    remaining === null
      ? null
      : verdict === "ALLOW"
        ? remaining - action.amountYocto
        : remaining;
  return {
    verdict,
    firedRules,
    remainingBudget,
    receipt: [
      `LEASH / ${new Date(now).toISOString()}`,
      `${action.kind} → ${action.receiver}`,
      `Value: ${formatNear(action.amountYocto)} NEAR${token !== "NEAR" ? ` equivalent / ${token}` : ""}`,
      ...reasons,
      ...(verdict === "ASK_HUMAN"
        ? [
            `Above ${formatNear(policy.askHumanAboveYocto!)} NEAR: paused for human review. No approval or execution endpoint exists.`,
          ]
        : []),
      ...(verdict === "ALLOW"
        ? ["All configured checks passed. Added to simulated session spending."]
        : []),
      `Rules: ${firedRules.join(" · ")}`,
      `Budget left: ${remainingBudget === null ? "unbounded" : `${formatNear(remainingBudget)} NEAR`}`,
      `${verdict} / SIMULATION ONLY — no transaction sent`,
    ],
  };
}
