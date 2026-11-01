import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify } from "@/lib/policy";

// Durable-mode concurrency tests: a CAS-faithful fake of the PostgREST
// surface the persistence layer uses. The fake applies the state->>v filter
// exactly like PostgREST (the check and the write are one UPDATE) and adds
// latency so parallel requests interleave the way separate Vercel instances
// would.

type Row = { id: string; state: Record<string, unknown> };
let table: Map<string, Row>;

const tick = () => new Promise((r) => setTimeout(r, 5));

function fakePostgrest() {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const path = u.pathname.split("/rest/v1/")[1];
    if (path !== "leash_sessions")
      return new Response("[]", { status: 200 });
    const id = u.searchParams.get("id")?.replace(/^eq\./, "");
    if (init.method === "PATCH") {
      await tick(); // simulate network latency between read and write
      const expectV = Number(u.searchParams.get("state->>v")?.replace(/^eq\./, ""));
      const row = table.get(id!);
      const body = JSON.parse(init.body as string);
      if (!row || Number((row.state as { v?: number }).v ?? 0) !== expectV)
        return new Response("[]", { status: 200 }); // filter matched nothing
      row.state = body.state;
      return new Response(JSON.stringify([{ state: row.state }]), {
        status: 200,
      });
    }
    if (init.method === "POST") {
      await tick();
      const body = JSON.parse(init.body as string);
      if (!table.has(body.id)) {
        table.set(body.id, { id: body.id, state: body.state });
      }
      return new Response(null, { status: 201 });
    }
    // GET
    await tick();
    const row = table.get(id!);
    return new Response(JSON.stringify(row ? [{ state: row.state }] : []), {
      status: 200,
    });
  });
}

let compile: typeof import("@/app/api/compile/route").POST;
let evaluate: typeof import("@/app/api/evaluate/route").POST;
const post = (path: string, data: unknown, ip = "10.0.0.9") =>
  new Request(`http://localhost/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: stringify(data),
  });

const policy = async () =>
  (
    await (
      await compile(
        post("compile", { text: "only pay coffee.near; max 0.25 NEAR a day" }),
      )
    ).json()
  ).policy;

const coffee = (near: string) => ({
  kind: "transfer",
  receiver: "coffee.near",
  amountYocto: near,
});
const NEAR1 = "100000000000000000000000"; // 0.1 NEAR

beforeEach(async () => {
  vi.resetModules();
  table = new Map();
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "test-key";
  vi.stubEnv("NEBIUS_API_KEY", "");
  vi.stubEnv("VERCEL", "");
  vi.stubGlobal("fetch", fakePostgrest());
  ({ POST: compile } = await import("@/app/api/compile/route"));
  ({ POST: evaluate } = await import("@/app/api/evaluate/route"));
});

afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("durable idempotency under concurrency", () => {
  it("parallel retries of one requestId reserve budget exactly once", async () => {
    const p = await policy();
    const sessionId = "dur-session-00000001";
    const body = {
      sessionId,
      policy: p,
      action: coffee(NEAR1),
      requestId: "req-parallel-01",
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        evaluate(post("evaluate", body)).then((r) => r.json()),
      ),
    );
    const fresh = results.filter((r) => !r.duplicate);
    const dups = results.filter((r) => r.duplicate === true);
    expect(fresh).toHaveLength(1);
    expect(dups).toHaveLength(3);
    for (const r of results) {
      expect(r.verdict).toBe("ALLOW");
      expect(r.remainingBudget).toBe("150000000000000000000000"); // 0.15 NEAR left
    }
    // exactly one ledger entry was reserved
    const state = table.get(sessionId)!.state as {
      ledger: { amountYocto: string }[];
    };
    expect(state.ledger).toHaveLength(1);
  });

  it("parallel new actions at the budget edge admit exactly one spender", async () => {
    const p = await policy(); // max 0.25 NEAR a day
    const sessionId = "dur-session-00000002";
    const mk = (reqId: string) => ({
      sessionId,
      policy: p,
      action: coffee("150000000000000000000000"), // 0.15 NEAR
      requestId: reqId,
    });
    const [a, b] = await Promise.all([
      evaluate(post("evaluate", mk("req-edge-000001"))).then((r) => r.json()),
      evaluate(post("evaluate", mk("req-edge-000002"))).then((r) => r.json()),
    ]);
    const verdicts = [a.verdict, b.verdict].sort();
    expect(verdicts).toEqual(["ALLOW", "BLOCK"]); // 0.15 + 0.15 > 0.25 NEAR
    const state = table.get(sessionId)!.state as {
      ledger: { amountYocto: string }[];
    };
    expect(state.ledger).toHaveLength(1);
  });

  it("a payload mismatch on a used requestId is 409 even in durable mode", async () => {
    const p = await policy();
    const sessionId = "dur-session-00000003";
    const first = await evaluate(
      post("evaluate", {
        sessionId,
        policy: p,
        action: coffee(NEAR1),
        requestId: "req-mismatch-001",
      }),
    );
    expect(first.status).toBe(200);
    const res = await evaluate(
      post("evaluate", {
        sessionId,
        policy: p,
        action: coffee("200000000000000000000000"),
        requestId: "req-mismatch-001",
      }),
    );
    expect(res.status).toBe(409);
  });
});
