/** Browser-safe Base constants and exact ETH/wei arithmetic. */
export const WEI_PER_ETH = 10n ** 18n;
export const MAX_UINT256 = 2n ** 256n - 1n;
export const BASE_CHAIN_ID = 84532;
// Low 160 bits of keccak256("coffee") / keccak256("weather"), matching Deploy.s.sol.
export const DEMO_RECEIVERS = [
  "0x3bd349193d64331371ae5d047e0f91db989e8e35",
  "0x6f2e2f1380aa176569b6c84f16d7f2ced5965666",
] as const;
export const BASE_DECISIONS = ["ALLOW", "ASK_HUMAN", "BLOCK"] as const;
// ABI enum order in LeashVault.sol. These names deliberately describe EVM rules.
export const BASE_REASONS = [
  "POLICY_PASSED",
  "PER_TX_CAP",
  "DAILY_CAP",
  "ALLOWLIST",
  "RATE_LIMIT",
  "ACTIVE_HOURS",
  "METHOD",
  "PAUSED",
  "NEEDS_APPROVAL",
  "INSUFFICIENT_BALANCE",
] as const;
export type BaseReason = (typeof BASE_REASONS)[number];
export const BASE_REASON_TEXT: Record<BaseReason, string> = {
  POLICY_PASSED: "All configured spending checks passed.",
  PER_TX_CAP: "Payment exceeds the per-transaction cap.",
  DAILY_CAP: "Payment exceeds the remaining daily budget.",
  ALLOWLIST: "Receiver is outside the exact address allowlist.",
  RATE_LIMIT: "The rolling 60-minute action limit has been reached.",
  ACTIVE_HOURS: "Outside the permitted hours in the policy's UTC offset.",
  METHOD: "Function selector is not permitted for this receiver.",
  PAUSED: "The owner has paused agent spending.",
  NEEDS_APPROVAL:
    "Above the human threshold. An actual agent transaction would queue an owner request.",
  INSUFFICIENT_BALANCE: "The vault has insufficient ETH for this payment.",
};

export function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function parseWei(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,78}$/.test(value))
    throw new Error("amountWei must be an unsigned decimal string.");
  const amount = BigInt(value);
  if (amount > MAX_UINT256)
    throw new Error("Amount exceeds EVM uint256 range.");
  return amount;
}

export function parseEth(value: string): bigint {
  const input = value.trim();
  if (input.length > 79 || !/^\d+(?:\.\d{1,18})?$/.test(input))
    throw new Error(
      "Use a non-negative ETH amount with at most 18 decimal places.",
    );
  const [whole, fraction = ""] = input.split(".");
  const amount = BigInt(whole) * WEI_PER_ETH + BigInt(fraction.padEnd(18, "0"));
  if (amount > MAX_UINT256)
    throw new Error("Amount exceeds EVM uint256 range.");
  return amount;
}

export function formatEth(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const amount = value < 0n ? -value : value;
  const fraction = (amount % WEI_PER_ETH)
    .toString()
    .padStart(18, "0")
    .replace(/0+$/, "");
  return `${sign}${amount / WEI_PER_ETH}${fraction ? `.${fraction}` : ""}`;
}
