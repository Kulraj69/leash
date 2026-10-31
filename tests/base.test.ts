import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASE_ABI,
  BaseReader,
  DEFAULT_BASE_RPC_URL,
  decodeAddress,
  decodeBool,
  decodeCheck,
  decodePolicy,
  decodeUint,
  encodeCheck,
  parsePaymentPreview,
} from "@/lib/base";
import {
  BASE_REASONS,
  DEMO_RECEIVERS,
  MAX_UINT256,
  formatEth,
  parseEth,
  parseWei,
} from "@/lib/base-values";

const address = "0x1111111111111111111111111111111111111111";
const owner = "0x2222222222222222222222222222222222222222";
const agent = "0x3333333333333333333333333333333333333333";
const abi = (...values: bigint[]) =>
  `0x${values.map((v) => BigInt.asUintN(256, v).toString(16).padStart(64, "0")).join("")}`;
const policy = abi(
  200000000000000n,
  50000000000000n,
  30000000000000n,
  5n,
  0n,
  0n,
  330n,
);

function mockRpc(overrides: Record<string, unknown> = {}) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const { id, method, params } = JSON.parse(init!.body as string);
    const results: Record<string, unknown> = {
      eth_chainId: "0x14a34",
      eth_blockNumber: "0x2a",
      eth_getCode: "0x60006000",
      eth_getBalance: "0x38d7ea4c68000",
      [BASE_ABI.policy]: policy,
      [BASE_ABI.spentToday]: abi(10000000000000n),
      [BASE_ABI.actionsLastHour]: abi(2n),
      [BASE_ABI.owner]: abi(BigInt(owner)),
      [BASE_ABI.agent]: abi(BigInt(agent)),
      [BASE_ABI.paused]: abi(0n),
      [BASE_ABI.check]: abi(0n, 0n),
      ...overrides,
    };
    const key = method === "eth_call" ? params[0].data.slice(0, 10) : method;
    if (!(key in results)) throw new Error(`Unexpected RPC method: ${method}`);
    return Response.json({ jsonrpc: "2.0", id, result: results[key] });
  });
}

beforeEach(() => {
  vi.stubEnv("BASE_VAULT_ADDRESS", "");
  vi.stubEnv("NEXT_PUBLIC_LEASH_BASE_ADDRESS", "");
  vi.stubEnv("BASE_RPC_URL", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Base exact units and ABI", () => {
  it("round trips 18-decimal ETH and uint256 without floating point", () => {
    expect(parseEth("1.000000000000000001")).toBe(1000000000000000001n);
    expect(formatEth(30000000000000n)).toBe("0.00003");
    expect(formatEth(-1n)).toBe("-0.000000000000000001");
    expect(parseEth(formatEth(MAX_UINT256))).toBe(MAX_UINT256);
    expect(parseWei(MAX_UINT256.toString())).toBe(MAX_UINT256);
  });
  it.each(["-1", "1e2", "1,000", ".1", "0.0000000000000000001", "", "1."])(
    "rejects invalid ETH %s",
    (input) => {
      expect(() => parseEth(input)).toThrow();
    },
  );
  it("rejects wei numbers, negatives, scientific notation and overflow", () => {
    for (const value of [
      1,
      -1,
      "-1",
      "1e18",
      "0x1",
      "1.0",
      (MAX_UINT256 + 1n).toString(),
    ])
      expect(() => parseWei(value)).toThrow();
    expect(() => parseEth((MAX_UINT256 + 1n).toString())).toThrow();
  });
  it("matches cast calldata for address, uint256 and right-padded bytes4", () => {
    // cast calldata 'check(address,uint256,bytes4)' 0x111...111 123 0x12345678
    expect(encodeCheck(address, 123n, "0x12345678")).toBe(
      "0xbc2865a10000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000007b1234567800000000000000000000000000000000000000000000000000000000",
    );
    expect(encodeCheck(address, MAX_UINT256)).toBe(
      BASE_ABI.check +
        "0".repeat(24) +
        address.slice(2) +
        "f".repeat(64) +
        "0".repeat(64),
    );
  });
  it("rejects malformed ABI arguments and out-of-range values", () => {
    expect(() => encodeCheck("0x1234", 1n)).toThrow();
    expect(() => encodeCheck(address, -1n)).toThrow();
    expect(() => encodeCheck(address, MAX_UINT256 + 1n)).toThrow();
    expect(() => encodeCheck(address, 1n, "0x1234567890")).toThrow();
  });
  it("decodes full-width amounts and canonical sign-extended offsets", () => {
    expect(
      decodePolicy(abi(MAX_UINT256, 2n ** 128n, 1n, 5n, 540n, 1260n, -300n)),
    ).toEqual({
      dailyCapWei: MAX_UINT256.toString(),
      perTxCapWei: (2n ** 128n).toString(),
      askAboveWei: "1",
      maxActionsPerHour: 5,
      activeStartMinute: 540,
      activeEndMinute: 1260,
      utcOffsetMinutes: -300,
    });
    expect(decodePolicy(policy).utcOffsetMinutes).toBe(330);
    expect(decodeUint(abi(MAX_UINT256))).toBe(MAX_UINT256);
  });
  it("rejects malformed policy widths, minutes, rates and signed offsets", () => {
    for (const data of [
      "0x",
      policy + "00",
      policy.slice(0, -2),
      policy.replace(/.$/, "g"),
      abi(1n, 1n, 1n, 2n ** 32n, 0n, 0n, 330n),
      abi(1n, 1n, 1n, 5n, 1440n, 0n, 330n),
      abi(1n, 1n, 1n, 5n, 0n, 1440n, 330n),
      abi(1n, 1n, 1n, 5n, 0n, 0n, 841n),
      abi(1n, 1n, 1n, 5n, 0n, 0n, -721n),
      abi(1n, 1n, 1n, 5n, 0n, 0n, 65536n - 300n), // Missing sign extension.
    ])
      expect(() => decodePolicy(data)).toThrow();
  });
  it("decodes address and bool getters strictly", () => {
    expect(decodeAddress(abi(BigInt(owner)))).toBe(owner);
    expect(decodeBool(abi(1n))).toBe(true);
    expect(decodeBool(abi(0n))).toBe(false);
    expect(() => decodeAddress(abi(2n ** 160n))).toThrow();
    expect(() => decodeAddress(abi(0n))).toThrow();
    expect(() => decodeBool(abi(2n))).toThrow();
    expect(() => decodeUint("0x1")).toThrow();
  });
  it.each(BASE_REASONS.map((reason, index) => [reason, index] as const))(
    "decodes %s with the Solidity enum ordinal",
    (reason, index) => {
      const decision = index === 0 ? 0 : index === 8 ? 1 : 2;
      expect(decodeCheck(abi(BigInt(decision), BigInt(index)))).toEqual({
        verdict: ["ALLOW", "ASK_HUMAN", "BLOCK"][decision],
        reason,
      });
    },
  );
  it("rejects unknown enums and inconsistent decision/reason pairs", () => {
    for (const data of [
      abi(3n, 0n),
      abi(2n, 10n),
      abi(0n, 8n),
      abi(1n, 1n),
      abi(2n, 0n),
      abi(2n, 8n),
      "0x",
    ])
      expect(() => decodeCheck(data)).toThrow();
  });
  it("validates and normalizes payment inputs", () => {
    expect(
      parsePaymentPreview({
        to: DEMO_RECEIVERS[0].toUpperCase().replace("0X", "0x"),
        amountWei: "000123",
      }),
    ).toEqual({ to: DEMO_RECEIVERS[0], amountWei: "123" });
    for (const value of [
      null,
      {},
      { to: "coffee.near", amountWei: "1" },
      { to: address, amountWei: 1 },
    ])
      expect(() => parsePaymentPreview(value)).toThrow();
  });
});

describe("read-only Base RPC", () => {
  it("shows not deployed with an explicit mock fixture and no RPC", async () => {
    const f = vi.fn<typeof fetch>();
    const view = await new BaseReader({ fetch: f }).vault();
    expect(view).toMatchObject({
      source: "mock",
      deployed: false,
      address: null,
      blockNumber: null,
      owner: null,
    });
    expect(view.label).toContain("Not deployed");
    expect(view.label).toContain("mock-vault");
    expect(f).not.toHaveBeenCalled();
  });
  it.each([
    ["30000000000000", "ALLOW", "POLICY_PASSED"],
    ["30000000000001", "ASK_HUMAN", "NEEDS_APPROVAL"],
    ["50000000000001", "BLOCK", "PER_TX_CAP"],
  ])("mock amount %s is %s", async (amountWei, verdict, reason) => {
    const view = await new BaseReader().vault({
      to: DEMO_RECEIVERS[0],
      amountWei,
    });
    expect(view.preview).toMatchObject({ verdict, reason });
    expect(view.spentTodayWei).toBe("0");
    expect(view.actionsLastHour).toBe("0");
  });
  it("uses exact mock receivers and preserves block precedence", async () => {
    const reader = new BaseReader();
    expect(
      (await reader.vault({ to: address, amountWei: MAX_UINT256.toString() }))
        .preview,
    ).toMatchObject({ verdict: "BLOCK", reason: "ALLOWLIST" });
    expect(
      (await reader.vault({ to: DEMO_RECEIVERS[1], amountWei: "0" })).preview
        ?.verdict,
    ).toBe("ALLOW");
  });
  it("reads live state and check at one block, exclusively through public RPC", async () => {
    const f = mockRpc({ [BASE_ABI.check]: abi(1n, 8n) });
    const payment = { to: DEMO_RECEIVERS[0], amountWei: "40000000000000" };
    const view = await new BaseReader({ address, fetch: f }).vault(payment);
    expect(view).toMatchObject({
      source: "live",
      deployed: true,
      address,
      owner,
      agent,
      chainId: 84532,
      blockNumber: "42",
      balanceWei: "1000000000000000",
      spentTodayWei: "10000000000000",
      actionsLastHour: "2",
      paused: false,
      preview: { ...payment, verdict: "ASK_HUMAN", reason: "NEEDS_APPROVAL" },
    });
    expect(view.policy.utcOffsetMinutes).toBe(330);
    expect(f).toHaveBeenCalledTimes(11);
    for (const [url, init] of f.mock.calls) {
      expect(url).toBe(DEFAULT_BASE_RPC_URL);
      expect(init?.cache).toBe("no-store");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const r = JSON.parse(init!.body as string);
      expect([
        "eth_chainId",
        "eth_blockNumber",
        "eth_getBalance",
        "eth_getCode",
        "eth_call",
      ]).toContain(r.method);
      if (r.method === "eth_call")
        expect(r.params).toMatchObject([{ to: address }, "0x2a"]);
      if (r.method === "eth_getBalance" || r.method === "eth_getCode")
        expect(r.params).toEqual([address, "0x2a"]);
    }
    const checks = f.mock.calls
      .map(([, init]) => JSON.parse(init!.body as string))
      .filter(
        (r) =>
          r.method === "eth_call" &&
          r.params[0].data.startsWith(BASE_ABI.check),
      );
    expect(checks[0].params[0].data).toBe(
      encodeCheck(payment.to, BigInt(payment.amountWei)),
    );
  });
  it("supports server address precedence and an environment RPC endpoint", async () => {
    vi.stubEnv("BASE_VAULT_ADDRESS", address);
    vi.stubEnv("NEXT_PUBLIC_LEASH_BASE_ADDRESS", owner);
    vi.stubEnv("BASE_RPC_URL", "https://base.example.test");
    const f = mockRpc();
    expect((await new BaseReader({ fetch: f }).vault()).address).toBe(address);
    expect(
      f.mock.calls.every(([url]) => url === "https://base.example.test"),
    ).toBe(true);
    expect(f).toHaveBeenCalledTimes(10); // No check unless requested.
  });
  it("uses the public address without tying Base live reads to NEAR mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_LEASH_BASE_ADDRESS", address);
    vi.stubEnv("NEAR_LIVE", "0");
    expect((await new BaseReader({ fetch: mockRpc() }).vault()).source).toBe(
      "live",
    );
  });
  it("rejects wrong networks before calling a vault", async () => {
    const f = mockRpc({ eth_chainId: "0x1" });
    await expect(new BaseReader({ address, fetch: f }).vault()).rejects.toThrow(
      "Base Sepolia",
    );
    expect(f).toHaveBeenCalledTimes(2);
  });
  it.each([
    { eth_getCode: "0x" },
    { eth_getCode: "0x1" },
    { eth_blockNumber: "0x00" },
    { eth_getBalance: "0xzz" },
    { [BASE_ABI.policy]: "0x" },
    { [BASE_ABI.paused]: abi(2n) },
    { [BASE_ABI.owner]: "0x" },
  ])("rejects absent code or malformed live data %j", async (overrides) => {
    await expect(
      new BaseReader({ address, fetch: mockRpc(overrides) }).vault(),
    ).rejects.toThrow();
  });
  it("does not turn a configured invalid address or URL into mock data", async () => {
    const f = vi.fn<typeof fetch>();
    await expect(
      new BaseReader({ address: "<ADDRESS>", fetch: f }).vault(),
    ).rejects.toThrow();
    await expect(
      new BaseReader({ address: "0x" + "0".repeat(40), fetch: f }).vault(),
    ).rejects.toThrow();
    await expect(
      new BaseReader({ address, rpcUrl: "file:///tmp/rpc", fetch: f }).vault(),
    ).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
  it.each(["network", "http", "rpc-error", "wrong-id", "invalid-json"])(
    "does not mask a %s failure",
    async (failure) => {
      const f = vi.fn<typeof fetch>(async () => {
        if (failure === "network") throw new Error("network failure");
        if (failure === "http") return new Response("error", { status: 503 });
        if (failure === "invalid-json") return new Response("not json");
        if (failure === "wrong-id")
          return Response.json({
            jsonrpc: "2.0",
            id: "wrong",
            result: "0x14a34",
          });
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          error: { message: "provider failure" },
        });
      });
      await expect(
        new BaseReader({ address, fetch: f }).vault(),
      ).rejects.toThrow();
    },
  );
});

describe("Base vault API", () => {
  let route: typeof import("@/app/api/base/vault/route");
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL", "");
    route = await import("@/app/api/base/vault/route");
  });
  const get = (query = "") =>
    new Request(`http://localhost/api/base/vault${query}`);
  const post = (value: unknown) =>
    new Request("http://localhost/api/base/vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  it("GET returns a labeled, uncached not-deployed fixture", async () => {
    const f = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", f);
    const response = await route.GET(get());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      source: "mock",
      deployed: false,
      address: null,
    });
    expect(f).not.toHaveBeenCalled();
  });
  it("supports both GET and POST payment previews without reserving spend", async () => {
    const input = { to: DEMO_RECEIVERS[0], amountWei: "40000000000000" };
    const responses = [
      await route.GET(get(`?to=${input.to}&amountWei=${input.amountWei}`)),
      await route.POST(post(input)),
    ];
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        source: "mock",
        spentTodayWei: "0",
        preview: { verdict: "ASK_HUMAN", reason: "NEEDS_APPROVAL" },
      });
    }
  });
  it("serves live policy, balance, spend and the contract's actual verdict", async () => {
    vi.stubEnv("BASE_VAULT_ADDRESS", address);
    const f = mockRpc({
      [BASE_ABI.check]: abi(2n, 7n),
      [BASE_ABI.paused]: abi(1n),
    });
    vi.stubGlobal("fetch", f);
    const response = await route.POST(
      post({
        to: DEMO_RECEIVERS[0],
        amountWei: "1",
        rpcUrl: "https://attacker.invalid",
        address: owner,
      }),
    );
    expect(response.status).toBe(200);
    const view = await response.json();
    expect(view).toMatchObject({
      source: "live",
      address,
      balanceWei: "1000000000000000",
      spentTodayWei: "10000000000000",
      paused: true,
      preview: { verdict: "BLOCK", reason: "PAUSED" },
    });
    expect(view.policy.dailyCapWei).toBe("200000000000000");
    expect(f.mock.calls.every(([url]) => url === DEFAULT_BASE_RPC_URL)).toBe(
      true,
    );
  });
  it.each([
    {},
    { to: address },
    { amountWei: "1" },
    { to: "0x1234", amountWei: "1" },
    { to: address, amountWei: 1 },
    { to: address, amountWei: "-1" },
    { to: address, amountWei: (MAX_UINT256 + 1n).toString() },
  ])("rejects malformed input before RPC %j", async (input) => {
    const f = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", f);
    expect((await route.POST(post(input))).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it("rejects incomplete query parameters, oversized URLs and bodies", async () => {
    expect((await route.GET(get(`?to=${address}`))).status).toBe(400);
    expect((await route.GET(get("?amountWei=1"))).status).toBe(400);
    expect((await route.GET(get(`?x=${"x".repeat(2100)}`))).status).toBe(413);
    expect(
      (await route.POST(post({ to: "x".repeat(2100), amountWei: "1" }))).status,
    ).toBe(413);
  });
  it("requires JSON and handles malformed bodies", async () => {
    expect(
      (
        await route.POST(
          new Request("http://localhost/api/base/vault", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await route.POST(
          new Request("http://localhost/api/base/vault", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("returns friendly 502 failures without exposing upstream details or substituting mocks", async () => {
    vi.stubEnv("BASE_VAULT_ADDRESS", address);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(new Error("private provider URL with credential")),
    );
    const response = await route.GET(get());
    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toContain("view-only Base RPC");
    expect(JSON.stringify(data)).not.toContain("credential");
    expect(data.source).toBeUndefined();
  });
  it("shares the existing rate limiter with NEAR routes", async () => {
    const { GET: near } = await import("@/app/api/near/account/route");
    vi.stubEnv("NEAR_LIVE", "0");
    for (let i = 0; i < 30; i++)
      expect((await route.GET(get())).status).toBe(200);
    const response = await near(
      new Request("http://localhost/api/near/account?id=alice.testnet"),
    );
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

