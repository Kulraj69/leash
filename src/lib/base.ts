import { record } from "./policy";
import {
  BASE_CHAIN_ID,
  BASE_DECISIONS,
  BASE_REASONS,
  DEMO_RECEIVERS,
  isEvmAddress,
  MAX_UINT256,
  parseWei,
  type BaseReason,
} from "./base-values";

export const DEFAULT_BASE_RPC_URL = "https://sepolia.base.org";
// Verified with `forge inspect --root contracts LeashVault methodIdentifiers`.
export const BASE_ABI = {
  check: "0xbc2865a1",
  policy: "0x0505c8c9",
  spentToday: "0xf059cf2b",
  actionsLastHour: "0x03a128ac",
  owner: "0x8da5cb5b",
  agent: "0xf5ff5c76",
  paused: "0x5c975abb",
} as const;

export type BasePolicy = {
  dailyCapWei: string;
  perTxCapWei: string;
  askAboveWei: string;
  maxActionsPerHour: number;
  activeStartMinute: number;
  activeEndMinute: number;
  utcOffsetMinutes: number;
};
export type PaymentPreview = { to: string; amountWei: string };
export type BaseCheck = {
  verdict: (typeof BASE_DECISIONS)[number];
  reason: BaseReason;
};
export type BaseVaultView = {
  chainId: typeof BASE_CHAIN_ID;
  source: "mock" | "live";
  deployed: boolean;
  label: string;
  address: string | null;
  owner: string | null;
  agent: string | null;
  blockNumber: string | null;
  policy: BasePolicy;
  balanceWei: string;
  spentTodayWei: string;
  actionsLastHour: string;
  paused: boolean;
  preview?: PaymentPreview & BaseCheck;
};

export function parsePaymentPreview(value: unknown): PaymentPreview {
  const input = record(value);
  if (!isEvmAddress(input.to))
    throw new Error("Enter a 0x-prefixed, 20-byte receiver address.");
  return {
    to: input.to.toLowerCase(),
    amountWei: parseWei(input.amountWei).toString(),
  };
}

function uintWord(value: bigint): string {
  if (value < 0n || value > MAX_UINT256)
    throw new Error("Invalid ABI uint256.");
  return value.toString(16).padStart(64, "0");
}

/** Static ABI: address/uint256 are left padded; bytes4 is right padded. Zero selector previews pay. */
export function encodeCheck(
  to: string,
  amountWei: bigint,
  selector = "0x00000000",
): string {
  if (!isEvmAddress(to) || !/^0x[0-9a-fA-F]{8}$/.test(selector))
    throw new Error("Invalid check address or bytes4 selector.");
  return (
    BASE_ABI.check +
    to.slice(2).toLowerCase().padStart(64, "0") +
    uintWord(amountWei) +
    selector.slice(2).toLowerCase().padEnd(64, "0")
  );
}

function words(data: unknown, count: number): bigint[] {
  if (
    typeof data !== "string" ||
    !/^0x[0-9a-fA-F]*$/.test(data) ||
    data.length !== 2 + count * 64
  )
    throw new Error("Malformed Base ABI response.");
  return Array.from({ length: count }, (_, i) =>
    BigInt(`0x${data.slice(2 + i * 64, 66 + i * 64)}`),
  );
}

export function decodeUint(data: unknown): bigint {
  return words(data, 1)[0];
}

export function decodeAddress(data: unknown): string {
  const value = decodeUint(data);
  if (value === 0n || value >= 2n ** 160n)
    throw new Error("Malformed Base address getter.");
  return `0x${value.toString(16).padStart(40, "0")}`;
}

export function decodeBool(data: unknown): boolean {
  const value = decodeUint(data);
  if (value !== 0n && value !== 1n)
    throw new Error("Malformed Base bool getter.");
  return value === 1n;
}

export function decodePolicy(data: unknown): BasePolicy {
  const [daily, perTx, ask, rate, start, end, rawOffset] = words(data, 7);
  const offset = BigInt.asIntN(256, rawOffset);
  if (
    rate > 2n ** 32n - 1n ||
    start > 1439n ||
    end > 1439n ||
    offset < -720n ||
    offset > 840n
  )
    throw new Error("Malformed Base policy fields.");
  return {
    dailyCapWei: daily.toString(),
    perTxCapWei: perTx.toString(),
    askAboveWei: ask.toString(),
    maxActionsPerHour: Number(rate),
    activeStartMinute: Number(start),
    activeEndMinute: Number(end),
    utcOffsetMinutes: Number(offset),
  };
}

export function decodeCheck(data: unknown): BaseCheck {
  const [decision, code] = words(data, 2);
  if (
    decision >= BigInt(BASE_DECISIONS.length) ||
    code >= BigInt(BASE_REASONS.length) ||
    (decision === 0n && code !== 0n) ||
    (decision === 1n && code !== 8n) ||
    (decision === 2n && (code === 0n || code === 8n))
  )
    throw new Error("Malformed Base decision enum.");
  return {
    verdict: BASE_DECISIONS[Number(decision)],
    reason: BASE_REASONS[Number(code)],
  };
}

function quantity(data: unknown): bigint {
  if (
    typeof data !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(data)
  )
    throw new Error("Malformed Base RPC quantity.");
  return BigInt(data);
}

function mockVault(input?: PaymentPreview): BaseVaultView {
  const view: BaseVaultView = {
    chainId: BASE_CHAIN_ID,
    source: "mock",
    deployed: false,
    label: "Not deployed · mock-vault · synthetic fixture, no on-chain call",
    address: null,
    owner: null,
    agent: null,
    blockNumber: null,
    policy: {
      dailyCapWei: "200000000000000",
      perTxCapWei: "50000000000000",
      askAboveWei: "30000000000000",
      maxActionsPerHour: 5,
      activeStartMinute: 0,
      activeEndMinute: 0,
      utcOffsetMinutes: 330,
    },
    balanceWei: "1000000000000000",
    spentTodayWei: "0",
    actionsLastHour: "0",
    paused: false,
  };
  if (input) {
    const amount = BigInt(input.amountWei);
    // Stateless Daily essentials fixture only; never presented as an eth_call result.
    let reason: BaseReason = "POLICY_PASSED";
    if (!DEMO_RECEIVERS.some((address) => address === input.to))
      reason = "ALLOWLIST";
    else if (amount > BigInt(view.policy.perTxCapWei)) reason = "PER_TX_CAP";
    else if (amount > BigInt(view.policy.askAboveWei))
      reason = "NEEDS_APPROVAL";
    view.preview = {
      ...input,
      reason,
      verdict:
        reason === "POLICY_PASSED"
          ? "ALLOW"
          : reason === "NEEDS_APPROVAL"
            ? "ASK_HUMAN"
            : "BLOCK",
    };
  }
  return view;
}

/** Server-side, view-only JSON-RPC. No signer, user-selected endpoint, or transaction method. */
export class BaseReader {
  constructor(
    private options: {
      address?: string;
      rpcUrl?: string;
      fetch?: typeof fetch;
    } = {},
  ) {}

  async vault(payment?: PaymentPreview): Promise<BaseVaultView> {
    const preview =
      payment === undefined ? undefined : parsePaymentPreview(payment);
    const configured = (
      this.options.address ??
      (process.env.BASE_VAULT_ADDRESS?.trim() ||
        process.env.NEXT_PUBLIC_LEASH_BASE_ADDRESS ||
        "")
    ).trim();
    if (!configured) return mockVault(preview);
    if (!isEvmAddress(configured) || BigInt(configured) === 0n)
      throw new Error("Invalid configured Base vault address.");
    const address = configured.toLowerCase();
    const url =
      this.options.rpcUrl ??
      (process.env.BASE_RPC_URL?.trim() || DEFAULT_BASE_RPC_URL);
    if (!/^https?:$/.test(new URL(url).protocol))
      throw new Error("Base RPC requires HTTP or HTTPS.");
    let requestId = 0;
    const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
      const id = ++requestId;
      const response = await (this.options.fetch ?? fetch)(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      if (!response.ok) throw new Error("Base RPC is unavailable.");
      const body = record(await response.json());
      if (
        body.error ||
        body.jsonrpc !== "2.0" ||
        body.id !== id ||
        body.result === undefined
      )
        throw new Error("Base RPC could not read this vault.");
      return body.result;
    };
    const [chain, block] = await Promise.all([
      rpc("eth_chainId", []),
      rpc("eth_blockNumber", []),
    ]);
    if (quantity(chain) !== BigInt(BASE_CHAIN_ID))
      throw new Error("RPC is not Base Sepolia.");
    const blockNumber = quantity(block).toString();
    const call = (data: string) =>
      rpc("eth_call", [{ to: address, data }, block]);
    const [code, balance, policy, spent, actions, owner, agent, paused, check] =
      await Promise.all([
        rpc("eth_getCode", [address, block]),
        rpc("eth_getBalance", [address, block]),
        call(BASE_ABI.policy),
        call(BASE_ABI.spentToday),
        call(BASE_ABI.actionsLastHour),
        call(BASE_ABI.owner),
        call(BASE_ABI.agent),
        call(BASE_ABI.paused),
        preview
          ? call(encodeCheck(preview.to, BigInt(preview.amountWei)))
          : Promise.resolve(undefined),
      ]);
    if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code))
      throw new Error("No contract deployed at the configured Base address.");
    return {
      chainId: BASE_CHAIN_ID,
      source: "live",
      deployed: true,
      label: "Live Base Sepolia · view only · no transaction sent",
      address,
      owner: decodeAddress(owner),
      agent: decodeAddress(agent),
      blockNumber,
      policy: decodePolicy(policy),
      balanceWei: quantity(balance).toString(),
      spentTodayWei: decodeUint(spent).toString(),
      actionsLastHour: decodeUint(actions).toString(),
      paused: decodeBool(paused),
      ...(preview ? { preview: { ...preview, ...decodeCheck(check) } } : {}),
    };
  }
}

export const baseReader = new BaseReader();
