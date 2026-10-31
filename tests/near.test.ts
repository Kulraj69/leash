import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_MS,
  DEFAULT_RPC_URL,
  NearReader,
  parseAccount,
} from "@/lib/near";
const account = {
  amount: "10000000000000000000000000",
  locked: "0",
  storage_usage: 2048,
  block_height: 42,
  block_hash: "test-block",
};
const keys = {
  keys: [
    {
      public_key: "ed25519:test-full",
      access_key: { nonce: 2, permission: "FullAccess" },
    },
    {
      public_key: "ed25519:test-limited",
      access_key: {
        nonce: 5,
        permission: {
          FunctionCall: {
            receiver_id: "weather.near",
            method_names: ["forecast"],
            allowance: "100000000000000000000000",
          },
        },
      },
    },
  ],
};
const rpc = () =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ result: account }))
    .mockResolvedValueOnce(Response.json({ result: keys }));
afterEach(() => vi.unstubAllEnvs());
describe("view-only NEAR RPC", () => {
  it("parses native and function-call key state without precision loss", () => {
    const value = parseAccount("alice.testnet", account, keys);
    expect(value.amountYocto).toBe(account.amount);
    expect(value.keys[0].permission).toBe("FullAccess");
    expect(value.keys[1].permission).toMatchObject({
      method_names: ["forecast"],
    });
  });
  it("keeps null allowances as unlimited", () => {
    const k = structuredClone(keys);
    const fc = k.keys[1].access_key.permission as {
      FunctionCall: { allowance: string | null };
    };
    fc.FunctionCall.allowance = null;
    expect(
      parseAccount("alice.testnet", account, k).keys[1].permission,
    ).toMatchObject({ allowance: null });
  });
  it("rejects malformed balances and unsafe integers", () => {
    expect(() =>
      parseAccount("alice.testnet", { ...account, amount: 1e24 }, keys),
    ).toThrow();
    expect(() =>
      parseAccount("alice.testnet", { ...account, storage_usage: NaN }, keys),
    ).toThrow();
  });
  it("rejects malformed access permissions", () =>
    expect(() =>
      parseAccount("alice.testnet", account, {
        keys: [
          {
            public_key: "test",
            access_key: { nonce: 0, permission: "Unknown" },
          },
        ],
      }),
    ).toThrow());
  it("defaults to explicitly synthetic data and never calls fetch", async () => {
    vi.stubEnv("NEAR_LIVE", "0");
    const f = vi.fn<typeof fetch>();
    const value = await new NearReader({ fetch: f }).account("alice.testnet");
    expect(f).not.toHaveBeenCalled();
    expect(value.source).toBe("mock");
    expect(value.label).toContain("mock-");
    expect(value.blockHash).toContain("mock-");
    expect(value.keys.every((k) => k.publicKey.startsWith("mock-"))).toBe(true);
  });
  it("only issues view_account and view_access_key_list queries", async () => {
    const f = rpc();
    const value = await new NearReader({ live: true, fetch: f }).account(
      "alice.testnet",
    );
    expect(value.source).toBe("live");
    expect(f).toHaveBeenCalledTimes(2);
    const requests = f.mock.calls.map(([, init]) =>
      JSON.parse(init!.body as string),
    );
    expect(requests.map((r) => r.method)).toEqual(["query", "query"]);
    expect(requests.map((r) => r.params.request_type)).toEqual([
      "view_account",
      "view_access_key_list",
    ]);
    expect(requests[0].params.finality).toBe("final");
    expect(requests[1].params.block_id).toBe(42);
    expect(f.mock.calls[0][0]).toBe(DEFAULT_RPC_URL);
  });
  it("honors a configured RPC URL", async () => {
    const f = rpc();
    await new NearReader({
      live: true,
      fetch: f,
      rpcUrl: "https://rpc.example.test",
    }).account("alice.testnet");
    expect(f.mock.calls[0][0]).toBe("https://rpc.example.test");
  });
  it("honors NEAR_LIVE and NEAR_RPC_URL environment settings", async () => {
    vi.stubEnv("NEAR_LIVE", "1");
    vi.stubEnv("NEAR_RPC_URL", "https://rpc.test.example");
    const f = rpc();
    expect(
      (await new NearReader({ fetch: f }).account("alice.testnet")).source,
    ).toBe("live");
    expect(f.mock.calls[0][0]).toBe("https://rpc.test.example");
  });
  it("caches within TTL and re-queries after expiry", async () => {
    let now = 0;
    const f = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, options) =>
        Response.json({
          result:
            JSON.parse(options!.body as string).params.request_type ===
            "view_account"
              ? account
              : keys,
        }),
      );
    const reader = new NearReader({ live: true, fetch: f, now: () => now });
    await reader.account("alice.testnet");
    await reader.account("alice.testnet");
    expect(f).toHaveBeenCalledTimes(2);
    now = CACHE_TTL_MS;
    await reader.account("alice.testnet");
    expect(f).toHaveBeenCalledTimes(4);
  });
  it("does not poison cached objects through callers", async () => {
    const reader = new NearReader({ live: false });
    const view = await reader.account("alice.testnet");
    view.keys.length = 0;
    expect((await reader.account("alice.testnet")).keys.length).toBe(2);
  });
  it("rejects invalid IDs before calling a provider", async () => {
    const f = vi.fn<typeof fetch>();
    await expect(
      new NearReader({ live: true, fetch: f }).account("a/../secret"),
    ).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
  it("surfaces RPC and HTTP failures without falling back to synthetic truth", async () => {
    await expect(
      new NearReader({
        live: true,
        fetch: vi
          .fn()
          .mockResolvedValue(
            Response.json({ error: { message: "unknown account" } }),
          ),
      }).account("alice.testnet"),
    ).rejects.toThrow();
    await expect(
      new NearReader({
        live: true,
        fetch: vi.fn().mockResolvedValue(new Response("no", { status: 503 })),
      }).account("alice.testnet"),
    ).rejects.toThrow();
  });
});

