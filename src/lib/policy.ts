export const YOCTO = 10n ** 24n;
export const MAX_U128 = 2n ** 128n - 1n;
export type Policy = {
  dailyBudgetYocto: bigint | null;
  perTxCapYocto: bigint | null;
  allowlist: string[] | null;
  blockedReceivers: string[];
  allowedMethods: Record<string, string[]>;
  askHumanAboveYocto: bigint | null;
  maxTxPerHour: number | null;
  activeHours: { start: number; end: number; timezone: "Asia/Kolkata" } | null;
  allowedTokens: string[] | null;
};

export function parseNear(input: string): bigint {
  const text = input.trim();
  if (!/^\d+(?:\.\d{1,24})?$/.test(text) || text.length > 65)
    throw new Error(
      "Use a non-negative NEAR amount with at most 24 decimal places.",
    );
  const [whole, fraction = ""] = text.split(".");
  const value = BigInt(whole) * YOCTO + BigInt(fraction.padEnd(24, "0"));
  if (value > MAX_U128) throw new Error("Amount exceeds NEAR's u128 range.");
  return value;
}
export function formatNear(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const n = value < 0n ? -value : value;
  const fraction = (n % YOCTO).toString().padStart(24, "0").replace(/0+$/, "");
  return `${sign}${n / YOCTO}${fraction ? `.${fraction}` : ""}`;
}
export function defaultPolicy(): Policy {
  return {
    dailyBudgetYocto: parseNear("2"),
    perTxCapYocto: parseNear("0.5"),
    allowlist: [],
    blockedReceivers: [],
    allowedMethods: {},
    askHumanAboveYocto: parseNear("0.3"),
    maxTxPerHour: 5,
    activeHours: null,
    allowedTokens: ["NEAR"],
  };
}
export function isAccountId(value: string): boolean {
  return (
    value.length >= 2 &&
    value.length <= 64 &&
    /^([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/.test(value)
  );
}
export function matchesReceiver(receiver: string, pattern: string): boolean {
  return pattern.startsWith("*.")
    ? receiver.endsWith(pattern.slice(1)) &&
        receiver.length > pattern.length - 1
    : receiver === pattern;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}
export function yocto(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,39}$/.test(value))
    throw new Error("Yocto amounts must be unsigned decimal strings.");
  const n = BigInt(value);
  if (n > MAX_U128) throw new Error("Amount exceeds NEAR's u128 range.");
  return n;
}
function strings(value: unknown, check: (s: string) => boolean): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some((x) => typeof x !== "string" || !check(x))
  )
    throw new Error("Invalid policy list.");
  return [...new Set(value as string[])].sort();
}
const receiverPattern = (s: string) =>
  isAccountId(s.startsWith("*.") ? s.slice(2) : s);
export const isMethod = (s: string) => /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(s);
export function parsePolicy(value: unknown): Policy {
  const p = record(value);
  const amount = (key: string) => (p[key] === null ? null : yocto(p[key]));
  const methods = Object.fromEntries(
    Object.entries(record(p.allowedMethods)).map(([receiver, list]) => {
      if (!receiverPattern(receiver))
        throw new Error("Invalid method receiver.");
      return [receiver, strings(list, isMethod)];
    }),
  );
  if (Object.keys(methods).length > 32)
    throw new Error("Too many method receivers.");
  let activeHours: Policy["activeHours"] = null;
  if (p.activeHours !== null) {
    const h = record(p.activeHours);
    if (
      h.timezone !== "Asia/Kolkata" ||
      !Number.isInteger(h.start) ||
      !Number.isInteger(h.end) ||
      Number(h.start) < 0 ||
      Number(h.start) > 1439 ||
      Number(h.end) < 0 ||
      Number(h.end) > 1439 ||
      h.start === h.end
    )
      throw new Error(
        "Invalid IST hours; use distinct minutes from 0 to 1439.",
      );
    activeHours = {
      start: Number(h.start),
      end: Number(h.end),
      timezone: "Asia/Kolkata",
    };
  }
  if (
    p.maxTxPerHour !== null &&
    (!Number.isInteger(p.maxTxPerHour) ||
      Number(p.maxTxPerHour) < 0 ||
      Number(p.maxTxPerHour) > 10000)
  )
    throw new Error("Invalid hourly limit.");
  return {
    dailyBudgetYocto: amount("dailyBudgetYocto"),
    perTxCapYocto: amount("perTxCapYocto"),
    askHumanAboveYocto: amount("askHumanAboveYocto"),
    allowlist:
      p.allowlist === null ? null : strings(p.allowlist, receiverPattern),
    blockedReceivers: strings(p.blockedReceivers, receiverPattern),
    allowedMethods: methods,
    maxTxPerHour: p.maxTxPerHour as number | null,
    activeHours,
    allowedTokens:
      p.allowedTokens === null
        ? null
        : strings(p.allowedTokens, (s) => s === "NEAR" || isAccountId(s)),
  };
}
export function stringify(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    space,
  );
}
export const PRESETS = [
  {
    name: "Daily essentials",
    text: "max 2 NEAR a day; never more than 0.5 NEAR per payment; only pay weather.near and coffee.near; ask me above 0.3 NEAR; no more than 5 payments an hour",
  },
  {
    name: "Office hours",
    text: "max 1 NEAR a day; never more than 0.2 NEAR per payment; only pay api.weather.near; only methods forecast on api.weather.near; ask me above 0.1 NEAR; no more than 3 payments an hour; only between 9am and 9pm",
  },
  {
    name: "Coffee network",
    text: "max 3 NEAR a day; never more than 0.5 NEAR per payment; only pay *.coffee.near; block evil.coffee.near; ask me above 0.3 NEAR; no more than 8 payments an hour; only tokens NEAR",
  },
];
