// DRAFT - local only, never deployed, unaudited.
// LeashVault semantics mirrored for NEAR in near-sdk-js: one human owner
// administers spending rules for one agent account. The contract holds NEAR
// and decides ALLOW / ASK_HUMAN / BLOCK for each proposed transfer.
// Amounts are yoctoNEAR decimal strings (u128). Day boundaries follow the
// owner-set UTC offset (IST = 330), matching the web engine.

// The NEAR JSVM runtime injects `env` as a global with the raw host
// functions; the SDK itself uses it internally without importing it.
declare const env: {
  promise_result(promiseIndex: bigint, registerId: bigint): bigint;
};

import { NearBindgen, near, call, view, initialize, LookupMap, Vector, assert } from "near-sdk-js";
import { AccountId, NearPromise } from "near-sdk-js";

type Decision = "ALLOW" | "ASK_HUMAN" | "BLOCK";
type Reason =
  | "POLICY_PASSED"
  | "PER_TX_CAP"
  | "DAILY_CAP"
  | "ALLOWLIST"
  | "RATE_LIMIT"
  | "ACTIVE_HOURS"
  | "PAUSED"
  | "INSUFFICIENT_BALANCE";

interface Policy {
  dailyCap: string; // yocto, "0" denies spending
  perTxCap: string; // yocto
  askAbove: string; // yocto; above this a human approves first
  maxActionsPerHour: number;
  activeStartMinute: number; // 0-1439
  activeEndMinute: number; // 0-1439; equal start/end = all hours
  utcOffsetMinutes: number; // -720..840
}

interface SpendRequest {
  id: number;
  receiver: AccountId;
  amount: string;
  memo: string;
  status: "PENDING" | "IN_FLIGHT" | "REJECTED" | "EXECUTED";
}

interface Verdict {
  decision: Decision;
  reason: Reason;
  requestId?: number;
}

// One record per transfer attempt, so a callback settles exactly the attempt
// it belongs to - replays and stale callbacks mutate nothing.
interface Attempt {
  id: number;
  receiver: AccountId;
  amount: string;
  day: number;
  requestId: number;
  resolved: boolean;
}

const MINUTES_PER_DAY = 1440;

@NearBindgen({ requireInit: true })
export class LeashVault {
  owner: AccountId = "";
  agent: AccountId = "";
  paused: boolean = false;
  policy: Policy = {
    dailyCap: "0",
    perTxCap: "0",
    askAbove: "0",
    maxActionsPerHour: 0,
    activeStartMinute: 0,
    activeEndMinute: 0,
    utcOffsetMinutes: 330,
  };
  receivers: LookupMap<boolean> = new LookupMap<boolean>("r");
  spentByDay: LookupMap<string> = new LookupMap<string>("d");
  // Yocto owed to in-flight transfer promises. Evaluation never lets new
  // proposals spend past (balance - reserved), so concurrent approvals in
  // one block cannot overspend the real balance.
  reserved: string = "0";
  requests: LookupMap<SpendRequest> = new LookupMap<SpendRequest>("q");
  attempts: LookupMap<Attempt> = new LookupMap<Attempt>("a");
  nextAttemptId: number = 1;
  actionTimes: Vector<number> = new Vector<number>("t");
  nextRequestId: number = 1;

  @initialize({})
  init({ owner, agent }: { owner: AccountId; agent: AccountId }): void {
    assert(owner !== "" && agent !== "", "owner and agent required");
    this.owner = owner;
    this.agent = agent;
  }

  private onlyOwner(): void {
    assert(near.predecessorAccountId() === this.owner, "owner only");
  }

  private onlyAgent(): void {
    assert(near.predecessorAccountId() === this.agent, "agent only");
  }

  // Current local minute-of-day and day index under the policy offset.
  private clock(): { minute: number; day: number } {
    const ms = Number(near.blockTimestamp() / BigInt(1_000_000));
    const shifted = Math.floor(ms / 60000) + this.policy.utcOffsetMinutes;
    const day = Math.floor(shifted / MINUTES_PER_DAY);
    const minute = ((shifted % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    return { minute, day };
  }

  private withinHours(minute: number): boolean {
    const { activeStartMinute: s, activeEndMinute: e } = this.policy;
    if (s === e) return true;
    return s < e ? minute >= s && minute < e : minute >= s || minute < e;
  }

  private spentToday(day: number): bigint {
    return BigInt(this.spentByDay.get(String(day)) ?? "0");
  }

  private recordSpend(day: number, amount: bigint): void {
    this.spentByDay.set(String(day), (this.spentToday(day) + amount).toString());
    const nowMs = Number(near.blockTimestamp() / BigInt(1_000_000));
    const cutoff = nowMs - 3_600_000;
    // Rolling hour: keep only entries from the last hour, then append this one.
    const kept: number[] = [];
    for (let i = 0; i < this.actionTimes.length; i++) {
      const t = this.actionTimes.get(i) ?? 0;
      if (t >= cutoff) kept.push(t);
    }
    while (this.actionTimes.length > 0) this.actionTimes.pop();
    for (const t of kept) this.actionTimes.push(t);
    this.actionTimes.push(nowMs);
  }

  private evaluate(
    receiver: AccountId,
    amount: bigint,
    ignoreAsk = false
  ): { decision: Decision; reason: Reason } {
    if (this.paused) return { decision: "BLOCK", reason: "PAUSED" };
    if (!this.receivers.get(receiver)) return { decision: "BLOCK", reason: "ALLOWLIST" };
    const available = near.accountBalance() - BigInt(this.reserved);
    if (available < amount) return { decision: "BLOCK", reason: "INSUFFICIENT_BALANCE" };
    const perTx = BigInt(this.policy.perTxCap);
    if (perTx === 0n || amount > perTx) return { decision: "BLOCK", reason: "PER_TX_CAP" };
    const { minute, day } = this.clock();
    if (!this.withinHours(minute)) return { decision: "BLOCK", reason: "ACTIVE_HOURS" };
    const daily = BigInt(this.policy.dailyCap);
    if (daily === 0n || this.spentToday(day) + amount > daily)
      return { decision: "BLOCK", reason: "DAILY_CAP" };
    const cutoff = Number(near.blockTimestamp() / BigInt(1_000_000)) - 3_600_000;
    let recent = 0;
    for (let i = 0; i < this.actionTimes.length; i++) {
      if ((this.actionTimes.get(i) ?? 0) >= cutoff) recent++;
    }
    if (recent >= this.policy.maxActionsPerHour) return { decision: "BLOCK", reason: "RATE_LIMIT" };
    // ignoreAsk: an owner approving a parked request IS the human answer,
    // so the ask tier must not re-park it forever.
    if (!ignoreAsk && amount > BigInt(this.policy.askAbove))
      return { decision: "ASK_HUMAN", reason: "POLICY_PASSED" };
    return { decision: "ALLOW", reason: "POLICY_PASSED" };
  }

  private reserveAndTransfer(
    receiver: AccountId,
    amount: bigint,
    day: number,
    requestId: number
  ): void {
    const attemptId = this.nextAttemptId++;
    this.attempts.set(String(attemptId), {
      id: attemptId,
      receiver,
      amount: amount.toString(),
      day,
      requestId,
      resolved: false,
    });
    this.recordSpend(day, amount);
    this.reserved = (BigInt(this.reserved) + amount).toString();
    // Transfer first, then a self-callback reports the promise outcome.
    // build() attaches the chain eagerly: propose/approve must return the
    // Verdict, so they cannot return the promise itself - and an unreturned
    // NearPromise is dropped silently, which would record spend without
    // ever moving funds.
    // GAS REQUIREMENT for callers: the 100 Tgas attached to the callback is
    // prepaid out of the caller's gas, so propose/approve must be invoked
    // with well over 100 Tgas (the sandbox harness uses 250 Tgas). A wallet
    // default of 30 Tgas is NOT sufficient and makes the call run out of gas.
    NearPromise.new(receiver)
      .transfer(amount)
      .then(
        NearPromise.new(near.currentAccountId()).functionCall(
          "on_transfer_complete",
          JSON.stringify({ attemptId }),
          0n,
          100_000_000_000_000n
        )
      )
      .build();
  }

  /// Self-callback after every transfer promise. Settles exactly one
  /// attempt: replays, duplicates and stale callbacks return without
  /// touching the ledger or the reservation.
  @call({ privateFunction: true })
  on_transfer_complete({ attemptId }: { attemptId: number }): void {
    assert(
      near.predecessorAccountId() === near.currentAccountId(),
      "self callback only"
    );
    const attempt = this.attempts.get(String(attemptId));
    assert(attempt !== null, "unknown attempt");
    if (attempt!.resolved) return; // exactly-once
    attempt!.resolved = true;
    this.attempts.set(String(attemptId), attempt!);

    const value = BigInt(attempt!.amount);
    const reserved = BigInt(this.reserved);
    this.reserved = (reserved > value ? reserved - value : 0n).toString();

    const reqId = attempt!.requestId;
    // Read the outcome status directly from the host: the SDK's
    // near.promiseResult() asserts Successful, which panics the callback on a
    // failed transfer and makes this rollback path unreachable. Host codes:
    // 1 = Successful, 2 = Failed.
    const status = Number(env.promise_result(0n, 0n));
    if (status === 1) {
      if (reqId > 0) {
        const req = this.requests.get(String(reqId));
        if (req !== null && req.status === "IN_FLIGHT") {
          req.status = "EXECUTED";
          this.requests.set(String(reqId), req);
        }
      }
      return;
    }
    // Failure: roll back the ledger for the attempt's ORIGINAL day, even if
    // the callback lands after a day rollover.
    const key = String(attempt!.day);
    const spent = BigInt(this.spentByDay.get(key) ?? "0");
    this.spentByDay.set(key, (spent > value ? spent - value : 0n).toString());
    // A failed attempt returns the request to PENDING so the owner can retry.
    if (reqId > 0) {
      const req = this.requests.get(String(reqId));
      if (req !== null && req.status === "IN_FLIGHT") {
        req.status = "PENDING";
        this.requests.set(String(reqId), req);
      }
    }
  }

  // --- owner administration ---

  @call({})
  set_policy({ agent, policy }: { agent: AccountId; policy: Policy }): void {
    this.onlyOwner();
    assert(
      policy.activeStartMinute <= 1439 &&
        policy.activeEndMinute <= 1439 &&
        policy.utcOffsetMinutes >= -720 &&
        policy.utcOffsetMinutes <= 840,
      "invalid policy"
    );
    this.agent = agent;
    this.policy = policy;
  }

  @call({})
  set_receiver({ receiver, allowed }: { receiver: AccountId; allowed: boolean }): void {
    this.onlyOwner();
    this.receivers.set(receiver, allowed);
  }

  @call({})
  set_paused({ paused }: { paused: boolean }): void {
    this.onlyOwner();
    this.paused = paused;
  }

  @call({ payableFunction: true })
  deposit(): void {
    this.onlyOwner();
    // Attached deposit simply stays in the contract balance.
  }

  // --- agent spending path ---

  /// Agent proposes a native NEAR transfer. ALLOW transfers immediately;
  /// ASK_HUMAN stores a pending request; BLOCK changes nothing.
  @call({})
  propose({ receiver, amount, memo }: { receiver: AccountId; amount: string; memo: string }): Verdict {
    this.onlyAgent();
    const value = BigInt(amount);
    const v = this.evaluate(receiver, value);
    if (v.decision === "BLOCK") return v;
    if (v.decision === "ASK_HUMAN") {
      const id = this.nextRequestId++;
      this.requests.set(String(id), { id, receiver, amount, memo, status: "PENDING" });
      return { decision: "ASK_HUMAN", reason: "POLICY_PASSED", requestId: id };
    }
    const { day } = this.clock();
    this.reserveAndTransfer(receiver, value, day, 0);
    return v;
  }

  /// Owner approves a pending request; re-evaluates against current policy
  /// and balance before paying, because either may have changed.
  @call({})
  approve({ id }: { id: number }): Verdict {
    this.onlyOwner();
    const req = this.requests.get(String(id));
    assert(req !== null, "unknown request");
    assert(req!.status === "PENDING", "request not pending");
    const v = this.evaluate(req!.receiver, BigInt(req!.amount), true);
    if (v.decision !== "ALLOW") return { decision: "BLOCK", reason: v.reason };
    const { day } = this.clock();
    // IN_FLIGHT blocks a second approve until the callback settles this
    // attempt: EXECUTED on success, back to PENDING on failure.
    req!.status = "IN_FLIGHT";
    this.requests.set(String(id), req!);
    this.reserveAndTransfer(req!.receiver, BigInt(req!.amount), day, id);
    return { decision: "ALLOW", reason: "POLICY_PASSED", requestId: id };
  }

  @call({})
  reject({ id }: { id: number }): void {
    this.onlyOwner();
    const req = this.requests.get(String(id));
    assert(req !== null, "unknown request");
    assert(req!.status === "PENDING", "request not pending");
    req!.status = "REJECTED";
    this.requests.set(String(id), req!);
  }

  // --- views ---

  @view({})
  check({ receiver, amount }: { receiver: AccountId; amount: string }): Verdict {
    return this.evaluate(receiver, BigInt(amount));
  }

  @view({})
  get_policy(): Policy {
    return this.policy;
  }

  @view({})
  get_request({ id }: { id: number }): SpendRequest | null {
    return this.requests.get(String(id));
  }

  @view({})
  spent_today(): string {
    return this.spentToday(this.clock().day).toString();
  }
}
