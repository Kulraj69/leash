import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../src/lib/store";

const KEY = "test-service-key";
let calls: { url: string; init: RequestInit }[] = [];

function sessionFixture(): Session {
  return {
    touched: 1_000,
    ledger: [{ amountYocto: 900_000_000_000_000_000_000_000n, timestamp: 900 }],
    gameLedgers: new Map([
      ["1:false", [{ amountYocto: 5n, timestamp: 800 }]],
    ]),
    attempts: [{ level: 1, harmful: false, verdict: "ALLOW", fixed: false }],
  };
}

describe("persistence (durable mode)", () => {
  beforeEach(async () => {
    vi.resetModules();
    calls = [];
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = KEY;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        if (url.includes("select=state"))
          return new Response("[]", { status: 200 });
        if (url.includes("leash_leaderboard?"))
          return new Response("[]", { status: 200 });
        return new Response(null, { status: 201 });
      }),
    );
  });
  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    vi.unstubAllGlobals();
  });

  it("reports durable only when both env vars are set", async () => {
    const p = await import("../src/lib/persistence");
    expect(p.durableEnabled()).toBe(true);
    delete process.env.SUPABASE_SERVICE_KEY;
    vi.resetModules();
    const p2 = await import("../src/lib/persistence");
    expect(p2.durableEnabled()).toBe(false);
  });

  it("sends the service key only as an Authorization/apikey header", async () => {
    const p = await import("../src/lib/persistence");
    await p.durableSaveSession("s1", sessionFixture());
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Bearer ${KEY}`);
    expect(h.apikey).toBe(KEY);
    expect(calls[0].url).not.toContain(KEY);
    expect(calls[0].url.startsWith("https://example.supabase.co/")).toBe(true);
  });

  it("round-trips bigint ledger entries through session state", async () => {
    const p = await import("../src/lib/persistence");
    const fixture = sessionFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        if (url.includes("select=state")) {
          const saved = calls.find((c) => c.init.method === "POST");
          const state = JSON.parse(saved!.init.body as string).state;
          return new Response(JSON.stringify([{ state }]), { status: 200 });
        }
        return new Response(null, { status: 201 });
      }),
    );
    await p.durableSaveSession("s1", fixture);
    const loaded = await p.durableLoadSession("s1");
    expect(loaded).not.toBeNull();
    expect(loaded!.ledger[0].amountYocto).toBe(fixture.ledger[0].amountYocto);
    expect(typeof loaded!.ledger[0].amountYocto).toBe("bigint");
    expect(loaded!.gameLedgers.get("1:false")![0].amountYocto).toBe(5n);
    expect(loaded!.attempts).toEqual(fixture.attempts);
  });

  it("leaderboard rows carry name and score only, never session state", async () => {
    const p = await import("../src/lib/persistence");
    await p.durablePublish("s1", {
      name: "kul",
      score: {
        attempts: 3,
        blocked: 1,
        held: 0,
        slipped: 0,
        safe: 2,
        cleared: [1, 2],
      },
      updatedAt: 123,
    });
    const body = calls[0].init.body as string;
    expect(body).not.toContain("ledger");
    expect(body).not.toContain("amountYocto");
    expect(body).not.toContain("harmful");
    expect(JSON.parse(body).sid).toBe("s1");
    expect(JSON.parse(body).score).toBe(2);
  });

  it("throws on Supabase errors instead of silently dropping writes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const p = await import("../src/lib/persistence");
    await expect(p.durableSaveSession("s1", sessionFixture())).rejects.toThrow(
      /500/,
    );
  });
});
