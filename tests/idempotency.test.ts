import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "@/lib/policy";
let compile: typeof import("@/app/api/compile/route").POST;
let evaluate: typeof import("@/app/api/evaluate/route").POST;
const post = (path: string, data: unknown) =>
  new Request(`http://localhost/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.9" },
    body: stringify(data),
  });
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("NEBIUS_API_KEY", "");
  vi.stubEnv("VERCEL", "");
  ({ POST: compile } = await import("@/app/api/compile/route"));
  ({ POST: evaluate } = await import("@/app/api/evaluate/route"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const policy = async () =>
  (
    await (
      await compile(
        post("compile", { text: "only pay coffee.near; max 2 NEAR a day" }),
      )
    ).json()
  ).policy;
const coffee = {
  kind: "transfer",
  receiver: "coffee.near",
  amountYocto: "100000000000000000000000",
};
const NEAR = (n: number) => (BigInt(n * 10) * 10n ** 23n).toString();

describe("evaluate idempotency", () => {
  it("a retry with the same requestId does not reserve budget twice", async () => {
    const p = await policy();
    const sessionId = "idem-session-0001";
    const body = { sessionId, policy: p, action: coffee, requestId: "req-aaaa-0001" };
    const first = await (await evaluate(post("evaluate", body))).json();
    const second = await (await evaluate(post("evaluate", body))).json();
    expect(first.verdict).toBe("ALLOW");
    expect(first.remainingBudget).toBe(NEAR(1.9));
    expect(second.verdict).toBe("ALLOW");
    expect(second.remainingBudget).toBe(NEAR(1.9));
    expect(second.duplicate).toBe(true);
    expect(first.duplicate).toBeUndefined();
  });

  it("a new requestId is a new action and reserves again", async () => {
    const p = await policy();
    const sessionId = "idem-session-0002";
    await evaluate(post("evaluate", { sessionId, policy: p, action: coffee, requestId: "req-bbbb-0001" }));
    const second = await (
      await evaluate(post("evaluate", { sessionId, policy: p, action: coffee, requestId: "req-bbbb-0002" }))
    ).json();
    expect(second.verdict).toBe("ALLOW");
    expect(second.remainingBudget).toBe(NEAR(1.8));
    expect(second.duplicate).toBeUndefined();
  });

  it("omitting requestId keeps every call a distinct new action", async () => {
    const p = await policy();
    const sessionId = "idem-session-omit1";
    const body = { sessionId, policy: p, action: coffee };
    const first = await (await evaluate(post("evaluate", body))).json();
    const second = await (await evaluate(post("evaluate", body))).json();
    expect(first.verdict).toBe("ALLOW");
    expect(second.verdict).toBe("ALLOW");
    expect(first.remainingBudget).toBe(NEAR(1.9));
    expect(second.remainingBudget).toBe(NEAR(1.8));
    expect(first.duplicate).toBeUndefined();
    expect(second.duplicate).toBeUndefined();
  });

  it("a malformed requestId is rejected 400", async () => {
    const p = await policy();
    const res = await evaluate(
      post("evaluate", {
        sessionId: "idem-session-bad01",
        policy: p,
        action: coffee,
        requestId: "bad id!",
      }),
    );
    expect(res.status).toBe(400);
    const bodyJson = await res.json();
    expect(bodyJson.error).toMatch(/requestId/);
  });

  it("a BLOCK verdict is replayed without re-evaluating", async () => {
    const p = await policy();
    const sessionId = "idem-session-block";
    const big = { ...coffee, amountYocto: NEAR(1) }; // over the 0.5 per-tx cap
    const body = { sessionId, policy: p, action: big, requestId: "req-block-0001" };
    const first = await (await evaluate(post("evaluate", body))).json();
    const second = await (await evaluate(post("evaluate", body))).json();
    expect(first.verdict).toBe("BLOCK");
    expect(second.verdict).toBe("BLOCK");
    expect(second.duplicate).toBe(true);
    expect(second.remainingBudget).toBe(first.remainingBudget);
  });

  it("the same requestId with a different payload is rejected 409", async () => {
    const p = await policy();
    const sessionId = "idem-session-0003";
    const first = await evaluate(
      post("evaluate", { sessionId, policy: p, action: coffee, requestId: "req-cccc-0001" }),
    );
    expect(first.status).toBe(200);
    const changed = {
      sessionId,
      policy: p,
      action: { ...coffee, amountYocto: "200000000000000000000000" },
      requestId: "req-cccc-0001",
    };
    const res = await evaluate(post("evaluate", changed));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/different payload/);
  });

  it("the idempotency store refuses new keys at the cap instead of evicting", async () => {
    vi.stubEnv("LEASH_MAX_SEEN_ACTIONS", "3");
    vi.resetModules();
    ({ POST: evaluate } = await import("@/app/api/evaluate/route"));
    ({ POST: compile } = await import("@/app/api/compile/route"));
    const p = await policy();
    const sessionId = "idem-session-0004";
    for (const n of ["0001", "0002", "0003"])
      await evaluate(
        post("evaluate", { sessionId, policy: p, action: coffee, requestId: `req-dddd-${n}` }),
      );
    const res = await evaluate(
      post("evaluate", { sessionId, policy: p, action: coffee, requestId: "req-dddd-0004" }),
    );
    expect(res.status).toBe(429);
    // The first key still replays as a duplicate - it was not evicted.
    const retry = await (
      await evaluate(
        post("evaluate", { sessionId, policy: p, action: coffee, requestId: "req-dddd-0001" }),
      )
    ).json();
    expect(retry.duplicate).toBe(true);
  });
});
