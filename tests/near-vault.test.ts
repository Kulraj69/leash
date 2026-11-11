// Behavior and adversarial tests for the DRAFT near-sdk-js LeashVault.
// The NEAR runtime is mocked in memory: no sandbox, no network, no wasm.
// These tests check ledger math, authorization, the approval re-evaluation
// window and known race directions - not NEAR protocol behavior.
import { describe, it, expect, vi } from "vitest";

// The callback entrypoint is not part of the public typing surface; the
// tests drive it through this narrow structural view instead of `any`.
type VaultInternal = { on_transfer_complete: (args: unknown) => void };

const ctx = vi.hoisted(() => ({
  predecessor: "owner.testnet",
  timeMs: Date.UTC(2026, 10, 1, 12, 0, 0), // 2026-11-01 12:00 UTC
  balance: 10n ** 25n, // 10 NEAR in yocto
  transfers: [] as { receiver: string; amount: bigint }[],
  callbacks: [] as { method: string; args: string }[],
  promiseResult: "Successful" as string,
  promiseBuilt: false,
}));

// Contract reads the transfer outcome via the JSVM host global `env`
// (status codes: 1 = Successful, 2 = Failed); the SDK's near.promiseResult
// asserts on failure, so the mock must provide the global too.
(globalThis as unknown as { env: unknown }).env = {
  promise_result: () => (ctx.promiseResult === "Successful" ? 1n : 2n),
};

vi.mock("near-sdk-js", () => {
  const noopMethod = () => (t: unknown, _k?: unknown, d?: unknown) => d ?? t;
  class LookupMap<T> {
    private m = new Map<string, T>();
    constructor() {}
    get(k: string): T | null {
      return this.m.has(k) ? (this.m.get(k) as T) : null;
    }
    set(k: string, v: T) {
      this.m.set(k, v);
    }
  }
  class Vector<T> {
    private a: T[] = [];
    constructor() {}
    get length() {
      return this.a.length;
    }
    get(i: number): T | null {
      return i < this.a.length ? this.a[i] : null;
    }
    push(v: T) {
      this.a.push(v);
    }
    pop() {
      this.a.pop();
    }
    swapRemove(i: number) {
      const v = this.a[i];
      this.a[i] = this.a[this.a.length - 1];
      this.a.pop();
      return v;
    }
  }
  class NearPromise {
    constructor(public account: string) {}
    static new(account: string) {
      return new NearPromise(account);
    }
    transfer(amount: bigint) {
      ctx.transfers.push({ receiver: this.account, amount });
      return this;
    }
    functionCall(method: string, args: string) {
      ctx.callbacks.push({ method, args });
      return this;
    }
    then() {
      return this;
    }
    build() {
      ctx.promiseBuilt = true;
      return this;
    }
  }
  return {
    NearBindgen: () => (cls: unknown) => cls,
    call: noopMethod,
    view: noopMethod,
    initialize: noopMethod,
    LookupMap,
    Vector,
    NearPromise,
    assert: (cond: boolean, msg: string) => {
      if (!cond) throw new Error(msg);
    },
    near: {
      predecessorAccountId: () => ctx.predecessor,
      currentAccountId: () => "vault.testnet",
      blockTimestamp: () => BigInt(ctx.timeMs) * 1_000_000n,
      accountBalance: () => ctx.balance,
      promiseResult: () => ctx.promiseResult,
    },
  };
});

import { LeashVault } from "../contracts-near/src/contract";

const Y = (near: number) => (BigInt(Math.round(near * 1e6)) * 10n ** 18n).toString();

const POLICY = {
  dailyCap: Y(2),
  perTxCap: Y(0.5),
  askAbove: Y(0.3),
  maxActionsPerHour: 5,
  activeStartMinute: 0,
  activeEndMinute: 0,
  utcOffsetMinutes: 330, // IST
};

function fresh(predecessor = "agent.testnet") {
  const v = new LeashVault();
  ctx.predecessor = "owner.testnet";
  ctx.transfers = [];
  ctx.timeMs = Date.UTC(2026, 10, 1, 12, 0, 0); // 17:30 IST
  ctx.balance = 10n ** 25n; // 10 NEAR
  ctx.callbacks = [];
  ctx.promiseResult = "Successful";
  ctx.promiseBuilt = false;
  v.init({ owner: "owner.testnet", agent: "agent.testnet" });
  v.set_policy({ agent: "agent.testnet", policy: { ...POLICY } });
  v.set_receiver({ receiver: "coffee.testnet", allowed: true });
  v.set_receiver({ receiver: "weather.testnet", allowed: true });
  ctx.predecessor = predecessor;
  return v;
}

function runCallback(v: InstanceType<typeof LeashVault>, result = "Successful", index = -1) {
  const cb = index === -1 ? ctx.callbacks[ctx.callbacks.length - 1] : ctx.callbacks[index];
  expect(cb.method).toBe("on_transfer_complete");
  ctx.promiseResult = result;
  ctx.predecessor = "vault.testnet"; // self-call
  (v as unknown as VaultInternal).on_transfer_complete(JSON.parse(cb.args));
  ctx.predecessor = "agent.testnet";
}

describe("authorization", () => {
  it("non-owner cannot administer", () => {
    const v = fresh("mallory.testnet");
    expect(() => v.set_policy({ agent: "x", policy: { ...POLICY } })).toThrow("owner only");
    expect(() => v.set_receiver({ receiver: "evil.testnet", allowed: true })).toThrow("owner only");
    expect(() => v.set_paused({ paused: true })).toThrow("owner only");
    expect(() => v.approve({ id: 1 })).toThrow("owner only");
    expect(() => v.reject({ id: 1 })).toThrow("owner only");
  });
  it("non-agent cannot propose", () => {
    const v = fresh("mallory.testnet");
    expect(() => v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "x" })).toThrow(
      "agent only"
    );
  });
  it("owner is not silently the agent", () => {
    const v = fresh("owner.testnet");
    expect(() => v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "x" })).toThrow(
      "agent only"
    );
  });
});

describe("allow path and ledger", () => {
  it("ALLOW transfers once and records spend", () => {
    const v = fresh();
    const r = v.propose({ receiver: "coffee.testnet", amount: Y(0.2), memo: "brew" });
    expect(r.decision).toBe("ALLOW");
    expect(ctx.transfers).toEqual([{ receiver: "coffee.testnet", amount: BigInt(Y(0.2)) }]);
    expect(v.spent_today()).toBe(Y(0.2));
  });
  it("per-tx cap blocks", () => {
    const v = fresh();
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.6), memo: "" }).reason).toBe(
      "PER_TX_CAP"
    );
    expect(ctx.transfers).toHaveLength(0);
  });
  it("daily cap accumulates across transfers", () => {
    const v = fresh();
    // 0.3 NEAR stays under the ask threshold; an hour passes between
    // transfers so the rate limit does not mask the daily-cap result.
    for (let i = 0; i < 6; i++) {
      expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" }).decision).toBe(
        "ALLOW"
      );
      ctx.timeMs += 3_600_001;
    }
    const r = v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" });
    expect(r.reason).toBe("DAILY_CAP"); // 1.8 + 0.3 would exceed the 2 NEAR day
    expect(ctx.transfers).toHaveLength(6);
  });
  it("unlisted receiver blocks; block changes nothing", () => {
    const v = fresh();
    expect(v.propose({ receiver: "evil.testnet", amount: Y(0.1), memo: "" }).reason).toBe(
      "ALLOWLIST"
    );
    expect(ctx.transfers).toHaveLength(0);
    expect(v.spent_today()).toBe("0");
  });
  it("zero caps deny spending", () => {
    const v = fresh();
    ctx.predecessor = "owner.testnet";
    v.set_policy({ agent: "agent.testnet", policy: { ...POLICY, perTxCap: "0" } });
    ctx.predecessor = "agent.testnet";
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).reason).toBe(
      "PER_TX_CAP"
    );
  });
  it("insufficient balance blocks", () => {
    const v = fresh();
    ctx.balance = BigInt(Y(0.05));
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).reason).toBe(
      "INSUFFICIENT_BALANCE"
    );
  });
});

describe("rate limit and active hours", () => {
  it("sixth action inside the hour blocks", () => {
    const v = fresh();
    for (let i = 0; i < 5; i++) {
      v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" });
    }
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).reason).toBe(
      "RATE_LIMIT"
    );
  });
  it("hour rolls over", () => {
    const v = fresh();
    for (let i = 0; i < 5; i++) {
      v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" });
    }
    ctx.timeMs += 3_600_001;
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).decision).toBe(
      "ALLOW"
    );
  });
  it("active-hours window blocks outside, wraps over midnight", () => {
    const v = fresh();
    ctx.predecessor = "owner.testnet";
    v.set_policy({
      agent: "agent.testnet",
      policy: { ...POLICY, activeStartMinute: 22 * 60, activeEndMinute: 2 * 60 }, // 22:00-02:00
    });
    ctx.predecessor = "agent.testnet";
    // 12:00 UTC = 17:30 IST -> outside
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).reason).toBe(
      "ACTIVE_HOURS"
    );
    // 20:00 UTC = 01:30 IST next day -> inside the wrap
    ctx.timeMs = Date.UTC(2026, 10, 1, 20, 0, 0);
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).decision).toBe(
      "ALLOW"
    );
  });
  it("daily spend resets at IST midnight, not UTC midnight", () => {
    const v = fresh();
    // 18:29:59 UTC = 23:59:59 IST
    ctx.timeMs = Date.UTC(2026, 10, 1, 18, 29, 59);
    v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" });
    // 18:30:01 UTC = 00:00:01 IST next day
    ctx.timeMs = Date.UTC(2026, 10, 1, 18, 30, 1);
    expect(v.spent_today()).toBe("0");
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" }).decision).toBe(
      "ALLOW"
    );
  });
});

describe("failed transfer frees its own hourly slot", () => {
  it("a failed transfer frees its slot: the agent can act again in the same hour", () => {
    const v = fresh();
    for (let i = 0; i < 5; i++) {
      v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" });
    }
    runCallback(v, "Failed", 2); // the third attempt's transfer fails
    // Slot freed: a sixth action inside the same hour is allowed.
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).decision).toBe(
      "ALLOW"
    );
  });

  it("failure frees exactly one slot, never other attempts' slots", () => {
    const v = fresh();
    for (let i = 0; i < 5; i++) {
      v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" });
    }
    runCallback(v, "Failed", 0);
    // Exactly one slot came back: one more action fits, the next is blocked.
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).decision).toBe(
      "ALLOW"
    );
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).reason).toBe(
      "RATE_LIMIT"
    );
  });

  it("identical timestamps: failure removes exactly its own entry, not every matching one", () => {
    const v = fresh();
    ctx.predecessor = "owner.testnet";
    v.set_policy({ agent: "agent.testnet", policy: { ...POLICY, maxActionsPerHour: 3 } });
    ctx.predecessor = "agent.testnet";
    // All three attempts land on the SAME mocked millisecond. A naive
    // remove-all-matching would free every slot; only the attempt's own
    // entry may go.
    for (let i = 0; i < 3; i++) {
      v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" });
    }
    runCallback(v, "Failed", 1);
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).decision).toBe(
      "ALLOW"
    );
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).reason).toBe(
      "RATE_LIMIT"
    );
  });

  it("a successful callback keeps the slot consumed", () => {
    const v = fresh();
    for (let i = 0; i < 5; i++) {
      v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" });
    }
    runCallback(v, "Successful", 4);
    // Success settles the spend; the hourly slot stays consumed.
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).reason).toBe(
      "RATE_LIMIT"
    );
  });
});

describe("ask-then-approve flow", () => {
  it("above ask threshold parks a request without spending", () => {
    const v = fresh();
    const r = v.propose({ receiver: "coffee.testnet", amount: Y(0.4), memo: "big brew" });
    expect(r.decision).toBe("ASK_HUMAN");
    expect(r.requestId).toBe(1);
    expect(ctx.transfers).toHaveLength(0);
    expect(v.spent_today()).toBe("0");
    expect(v.get_request({ id: 1 })?.status).toBe("PENDING");
  });
  it("approve pays after the success callback confirms", () => {
    const v = fresh();
    v.propose({ receiver: "coffee.testnet", amount: Y(0.4), memo: "" });
    ctx.predecessor = "owner.testnet";
    const r = v.approve({ id: 1 });
    expect(r.decision).toBe("ALLOW");
    expect(ctx.transfers).toEqual([{ receiver: "coffee.testnet", amount: BigInt(Y(0.4)) }]);
    expect(v.spent_today()).toBe(Y(0.4));
    // Not executed until the transfer promise is confirmed.
    expect(v.get_request({ id: 1 })?.status).toBe("IN_FLIGHT");
    runCallback(v);
    expect(v.get_request({ id: 1 })?.status).toBe("EXECUTED");
    ctx.predecessor = "owner.testnet";
  });
  it("approve re-evaluates: owner tightened the cap meanwhile -> blocked", () => {
    const v = fresh();
    v.propose({ receiver: "coffee.testnet", amount: Y(0.4), memo: "" });
    ctx.predecessor = "owner.testnet";
    v.set_policy({ agent: "agent.testnet", policy: { ...POLICY, perTxCap: Y(0.2) } });
    const r = v.approve({ id: 1 });
    expect(r.decision).toBe("BLOCK");
    expect(r.reason).toBe("PER_TX_CAP");
    expect(ctx.transfers).toHaveLength(0);
    expect(v.get_request({ id: 1 })?.status).toBe("PENDING"); // still pending, not consumed
  });
  it("approve re-evaluates: receiver removed meanwhile -> blocked", () => {
    const v = fresh();
    v.propose({ receiver: "coffee.testnet", amount: Y(0.4), memo: "" });
    ctx.predecessor = "owner.testnet";
    v.set_receiver({ receiver: "coffee.testnet", allowed: false });
    expect(v.approve({ id: 1 }).reason).toBe("ALLOWLIST");
  });
  it("reject is final; double-approve and approve-after-reject fail", () => {
    const v = fresh();
    v.propose({ receiver: "coffee.testnet", amount: Y(0.4), memo: "" });
    ctx.predecessor = "owner.testnet";
    v.reject({ id: 1 });
    expect(v.get_request({ id: 1 })?.status).toBe("REJECTED");
    expect(() => v.approve({ id: 1 })).toThrow("request not pending");
    ctx.predecessor = "agent.testnet";
    const again = v.propose({ receiver: "coffee.testnet", amount: Y(0.4), memo: "" });
    expect(again.requestId).toBe(2);
    ctx.predecessor = "owner.testnet";
    // id 1 stays rejected even though id 2 exists
    expect(() => v.approve({ id: 1 })).toThrow("request not pending");
    expect(v.approve({ id: 2 }).decision).toBe("ALLOW");
  });
  it("pause blocks everything", () => {
    const v = fresh();
    ctx.predecessor = "owner.testnet";
    v.set_paused({ paused: true });
    ctx.predecessor = "agent.testnet";
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).reason).toBe(
      "PAUSED"
    );
  });
});

describe("reservation accounting and promise callbacks", () => {
  it("two approvals in one block cannot overspend: reservation blocks the second", () => {
    const v = fresh();
    ctx.predecessor = "agent.testnet";
    v.propose({ receiver: "coffee.testnet", amount: Y(0.4), memo: "" });
    v.propose({ receiver: "weather.testnet", amount: Y(0.4), memo: "" });
    ctx.balance = BigInt(Y(0.5)); // only enough for one
    ctx.predecessor = "owner.testnet";
    expect(v.approve({ id: 1 }).decision).toBe("ALLOW");
    // balance is stale inside the block, but reserved = 0.4 leaves 0.1.
    const r = v.approve({ id: 2 });
    expect(r.decision).toBe("BLOCK");
    expect(r.reason).toBe("INSUFFICIENT_BALANCE");
    expect(ctx.transfers).toHaveLength(1);
  });
  it("immediate proposals respect the reservation in the same block", () => {
    const v = fresh();
    ctx.balance = BigInt(Y(0.4));
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" }).decision).toBe(
      "ALLOW"
    );
    // 0.4 balance - 0.3 reserved = 0.1 available.
    expect(v.propose({ receiver: "weather.testnet", amount: Y(0.2), memo: "" }).reason).toBe(
      "INSUFFICIENT_BALANCE"
    );
  });
  it("success callback frees the reservation and keeps the ledger", () => {
    const v = fresh();
    ctx.balance = BigInt(Y(0.4));
    v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" });
    runCallback(v, "Successful");
    expect(v.spent_today()).toBe(Y(0.3));
    // Reservation freed: another 0.3 does not fit the 0.1 real remainder,
    // but the reservation alone no longer blocks a 0.1 proposal.
    expect(v.propose({ receiver: "weather.testnet", amount: Y(0.1), memo: "" }).decision).toBe(
      "ALLOW"
    );
  });
  it("failed transfer rolls the ledger back and frees the reservation", () => {
    const v = fresh();
    ctx.balance = BigInt(Y(0.4));
    v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" });
    expect(v.spent_today()).toBe(Y(0.3));
    runCallback(v, "Failed");
    expect(v.spent_today()).toBe("0");
    // Rolled back: the same proposal evaluates cleanly again.
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" }).decision).toBe(
      "ALLOW"
    );
  });
  it("failed approved transfer leaves the request PENDING and retryable", () => {
    const v = fresh();
    v.propose({ receiver: "coffee.testnet", amount: Y(0.4), memo: "" });
    ctx.predecessor = "owner.testnet";
    v.approve({ id: 1 });
    expect(v.get_request({ id: 1 })?.status).toBe("IN_FLIGHT");
    runCallback(v, "Failed");
    ctx.predecessor = "owner.testnet";
    expect(v.get_request({ id: 1 })?.status).toBe("PENDING");
    expect(v.spent_today()).toBe("0"); // rolled back
    expect(v.approve({ id: 1 }).decision).toBe("ALLOW"); // retry works
    runCallback(v, "Successful");
    expect(v.get_request({ id: 1 })?.status).toBe("EXECUTED");
    expect(v.spent_today()).toBe(Y(0.4));
  });
  it("callback rejects non-self callers", () => {
    const v = fresh();
    v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" });
    const cb = ctx.callbacks[0];
    ctx.predecessor = "mallory.testnet";
    expect(() => (v as unknown as VaultInternal).on_transfer_complete(JSON.parse(cb.args))).toThrow(
      "self callback only"
    );
  });
  it("a replayed callback is ignored completely: no ledger or reservation drift", () => {
    const v = fresh();
    ctx.balance = BigInt(Y(0.4));
    v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" });
    runCallback(v, "Successful");
    // Replay the same settled attempt: exactly-once guard returns early.
    ctx.predecessor = "vault.testnet";
    ctx.promiseResult = "Failed"; // even with a flipped result, no rollback
    (v as unknown as VaultInternal).on_transfer_complete(JSON.parse(ctx.callbacks[0].args));
    expect(v.spent_today()).toBe(Y(0.3)); // spend kept
    // Reservation was freed once and is not freed again: a 0.1 proposal on
    // the real 0.4 balance fits exactly once.
    ctx.predecessor = "agent.testnet";
    expect(v.propose({ receiver: "weather.testnet", amount: Y(0.1), memo: "" }).decision).toBe(
      "ALLOW"
    );
  });
  it("double approve is impossible while the first attempt is in flight", () => {
    const v = fresh();
    v.propose({ receiver: "coffee.testnet", amount: Y(0.4), memo: "" });
    ctx.predecessor = "owner.testnet";
    expect(v.approve({ id: 1 }).decision).toBe("ALLOW");
    // Ample balance and caps - the IN_FLIGHT state, not evaluation, blocks it.
    expect(() => v.approve({ id: 1 })).toThrow("request not pending");
    expect(ctx.transfers).toHaveLength(1);
  });
  it("duplicate failed callback cannot free another transfer's reservation", () => {
    const v = fresh();
    ctx.balance = BigInt(Y(1));
    v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" }); // attempt 1
    v.propose({ receiver: "weather.testnet", amount: Y(0.2), memo: "" }); // attempt 2
    runCallback(v, "Failed", 0); // attempt 1 fails
    expect(v.spent_today()).toBe(Y(0.2)); // only attempt 1 rolled back
    // Replay attempt 1's failure: attempt 2's 0.2 reservation must survive.
    runCallback(v, "Failed", 0);
    expect(v.spent_today()).toBe(Y(0.2));
    // Clean reservation read: drop the real balance to 0.25. If attempt 2's
    // 0.2 reservation survived, only 0.05 is available and 0.1 blocks;
    // if the replay had wrongly freed it, 0.25 would allow it.
    ctx.balance = BigInt(Y(0.25));
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).reason).toBe(
      "INSUFFICIENT_BALANCE"
    );
    // Settle attempt 2: reservation frees and the same proposal passes.
    runCallback(v, "Successful", 1);
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.1), memo: "" }).decision).toBe(
      "ALLOW"
    );
  });
  it("stale callback from the first attempt is ignored after a retry", () => {
    const v = fresh();
    v.propose({ receiver: "coffee.testnet", amount: Y(0.4), memo: "" });
    ctx.predecessor = "owner.testnet";
    v.approve({ id: 1 }); // attempt 1
    runCallback(v, "Failed"); // attempt 1 fails -> PENDING
    ctx.predecessor = "owner.testnet";
    expect(v.approve({ id: 1 }).decision).toBe("ALLOW"); // retry = attempt 2
    // Late replay of attempt 1's callback after the retry is in flight:
    runCallback(v, "Failed", 0); // ignored: attempt 1 already resolved
    expect(v.get_request({ id: 1 })?.status).toBe("IN_FLIGHT");
    runCallback(v, "Successful", 1); // attempt 2 settles
    expect(v.get_request({ id: 1 })?.status).toBe("EXECUTED");
    expect(v.spent_today()).toBe(Y(0.4)); // exactly one spend recorded
  });
  it("callback reordering across a day rollover settles each attempt on its own day", () => {
    const v = fresh();
    // 23:59:59 IST: propose attempt A on day D
    ctx.timeMs = Date.UTC(2026, 10, 1, 18, 29, 59);
    v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "A" });
    // 00:00:01 IST next day: propose attempt B on day D+1
    ctx.timeMs = Date.UTC(2026, 10, 1, 18, 30, 1);
    v.propose({ receiver: "weather.testnet", amount: Y(0.3), memo: "B" });
    expect(v.spent_today()).toBe(Y(0.3)); // day D+1 ledger
    // Callbacks arrive out of order: B succeeds first, then A fails.
    runCallback(v, "Successful", 1); // B
    runCallback(v, "Failed", 0); // A: rolls back day D, not today
    expect(v.spent_today()).toBe(Y(0.3)); // B's spend intact on day D+1
    ctx.timeMs = Date.UTC(2026, 10, 1, 18, 29, 59); // look back at day D
    expect(v.spent_today()).toBe("0"); // A rolled back on its own day
  });
  it("invalid policy inputs are rejected", () => {
    const v = fresh("owner.testnet");
    expect(() =>
      v.set_policy({ agent: "a", policy: { ...POLICY, activeStartMinute: 1440 } })
    ).toThrow("invalid policy");
    expect(() =>
      v.set_policy({ agent: "a", policy: { ...POLICY, utcOffsetMinutes: 900 } })
    ).toThrow("invalid policy");
  });

  it("regression: transfer promise is scheduled eagerly (unreturned promises are dropped by the runtime)", () => {
    const v = fresh();
    const before = ctx.promiseBuilt;
    expect(v.propose({ receiver: "coffee.testnet", amount: Y(0.3), memo: "" }).decision).toBe("ALLOW");
    expect(ctx.promiseBuilt).toBe(true);
    expect(before).toBe(false);
    expect(ctx.transfers.length).toBe(1);
    expect(ctx.callbacks[0]?.method).toBe("on_transfer_complete");
  });
});
