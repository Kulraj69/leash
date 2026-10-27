import { isAccountId, record, yocto } from "./policy";
export type AccountView = {
  accountId: string;
  source: "mock" | "live";
  label: string;
  amountYocto: string;
  lockedYocto: string;
  storageUsage: number;
  blockHeight: number;
  blockHash: string;
  keys: {
    publicKey: string;
    nonce: number;
    permission:
      | "FullAccess"
      | {
          receiver_id: string;
          method_names: string[];
          allowance: string | null;
        };
  }[];
};
export const DEFAULT_RPC_URL = "https://rpc.testnet.near.org";
export const CACHE_TTL_MS = 30_000;
export function parseAccount(
  accountId: string,
  account: unknown,
  accessKeys: unknown,
): AccountView {
  const a = record(account),
    k = record(accessKeys);
  const unsigned = (v: unknown) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
      throw new Error("Malformed RPC integer.");
    return v;
  };
  if (typeof a.block_hash !== "string" || !Array.isArray(k.keys))
    throw new Error("Malformed RPC account response.");
  return {
    accountId,
    source: "live",
    label: "Live RPC · view only",
    amountYocto: yocto(a.amount).toString(),
    lockedYocto: yocto(a.locked).toString(),
    storageUsage: unsigned(a.storage_usage),
    blockHeight: unsigned(a.block_height),
    blockHash: a.block_hash,
    keys: k.keys.map((value) => {
      const entry = record(value),
        key = record(entry.access_key);
      if (typeof entry.public_key !== "string")
        throw new Error("Malformed RPC public key.");
      let permission: AccountView["keys"][number]["permission"] = "FullAccess";
      if (key.permission !== "FullAccess") {
        const fc = record(record(key.permission).FunctionCall);
        if (
          typeof fc.receiver_id !== "string" ||
          !isAccountId(fc.receiver_id) ||
          !Array.isArray(fc.method_names) ||
          fc.method_names.some((m) => typeof m !== "string")
        )
          throw new Error("Malformed function-call permission.");
        permission = {
          receiver_id: fc.receiver_id,
          method_names: fc.method_names as string[],
          allowance:
            fc.allowance === null ? null : yocto(fc.allowance).toString(),
        };
      }
      return {
        publicKey: entry.public_key,
        nonce: unsigned(key.nonce),
        permission,
      };
    }),
  };
}
export class NearReader {
  private cache = new Map<string, { expires: number; value: AccountView }>();
  constructor(
    private options: {
      live?: boolean;
      rpcUrl?: string;
      fetch?: typeof fetch;
      now?: () => number;
    } = {},
  ) {}
  async account(id: string): Promise<AccountView> {
    if (!isAccountId(id))
      throw new Error(
        "Enter a valid NEAR account ID (2–64 lowercase ASCII characters).",
      );
    const now = (this.options.now ?? Date.now)();
    const live = this.options.live ?? process.env.NEAR_LIVE === "1";
    const url =
      this.options.rpcUrl ?? process.env.NEAR_RPC_URL ?? DEFAULT_RPC_URL;
    const cacheKey = `${live}:${url}:${id}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expires > now) return structuredClone(hit.value);
    let value: AccountView;
    if (!live)
      value = {
        accountId: id,
        source: "mock",
        label: "mock-account · synthetic fixture, not this account's balance",
        amountYocto: "10000000000000000000000000",
        lockedYocto: "0",
        storageUsage: 5150,
        blockHeight: 5150,
        blockHash: "mock-block-5150",
        keys: [
          {
            publicKey: "mock-public-key-full-access",
            nonce: 0,
            permission: "FullAccess",
          },
          {
            publicKey: "mock-public-key-weather",
            nonce: 7,
            permission: {
              receiver_id: "weather.near",
              method_names: ["forecast"],
              allowance: "250000000000000000000000",
            },
          },
        ],
      };
    else {
      if (!/^https?:$/.test(new URL(url).protocol))
        throw new Error("RPC URL must use HTTP or HTTPS.");
      const query = async (
        request_type: "view_account" | "view_access_key_list",
        blockId?: number,
      ) => {
        const response = await (this.options.fetch ?? fetch)(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `leash-${request_type}`,
            method: "query",
            params: {
              request_type,
              account_id: id,
              ...(blockId === undefined
                ? { finality: "final" }
                : { block_id: blockId }),
            },
          }),
        });
        if (!response.ok)
          throw new Error("NEAR RPC is unavailable. Please try again shortly.");
        const body = record(await response.json());
        if (body.error)
          throw new Error(
            "NEAR RPC could not read this account. Check its network and account ID.",
          );
        return record(body.result);
      };
      const a = await query("view_account");
      if (
        typeof a.block_height !== "number" ||
        !Number.isSafeInteger(a.block_height)
      )
        throw new Error("Malformed RPC block height.");
      const k = await query("view_access_key_list", a.block_height);
      value = parseAccount(id, a, k);
    }
    for (const [key, hit] of this.cache)
      if (hit.expires <= now) this.cache.delete(key);
    if (this.cache.size >= 256)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(cacheKey, { expires: now + CACHE_TTL_MS, value });
    return structuredClone(value);
  }
}
export const nearReader = new NearReader();
