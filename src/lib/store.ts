import type { LedgerEntry } from "./firewall";
import { scoreAttempts, type GameAttempt, type Score } from "./game";
export type Session = {
  touched: number;
  ledger: LedgerEntry[];
  gameLedgers: Map<string, LedgerEntry[]>;
  attempts: GameAttempt[];
  // Idempotency: requestId -> JSON-safe Evaluation already returned for it.
  seenActions: Map<string, unknown>;
};
export type LeaderboardEntry = {
  name: string;
  score: Score;
  updatedAt: number;
};
const SESSION_TTL = 86_400_000;
export class MemoryStore {
  private sessions = new Map<string, Session>();
  private board = new Map<string, LeaderboardEntry>();
  session(id: string, now = Date.now()): Session {
    for (const [key, value] of this.sessions)
      if (now - value.touched >= SESSION_TTL) this.sessions.delete(key);
    let session = this.sessions.get(id);
    if (!session) {
      if (this.sessions.size >= 500)
        this.sessions.delete(this.sessions.keys().next().value!);
      session = {
        touched: now,
        ledger: [],
        gameLedgers: new Map(),
        attempts: [],
        seenActions: new Map(),
      };
      this.sessions.set(id, session);
    }
    session.touched = now;
    session.ledger = session.ledger.filter(
      (e) => e.timestamp > now - SESSION_TTL,
    );
    return session;
  }
  publish(id: string, rawName: string, now = Date.now()): LeaderboardEntry {
    const session = this.session(id, now);
    if (!session.attempts.length)
      throw new Error("Play a level before posting a score.");
    const name = rawName
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .trim()
      .slice(0, 16);
    if (!name)
      throw new Error(
        "Use a name with letters or numbers (up to 16 characters).",
      );
    const entry = {
      name,
      score: scoreAttempts(session.attempts),
      updatedAt: now,
    };
    if (!this.board.has(id) && this.board.size >= 100)
      this.board.delete(this.board.keys().next().value!);
    this.board.set(id, entry);
    return entry;
  }
  leaderboard(): LeaderboardEntry[] {
    return [...this.board.values()]
      .sort(
        (a, b) =>
          b.score.cleared.length - a.score.cleared.length ||
          a.score.slipped - b.score.slipped ||
          b.score.blocked + b.score.held - (a.score.blocked + a.score.held) ||
          a.updatedAt - b.updatedAt,
      )
      .slice(0, 20)
      .map((e) => structuredClone(e));
  }
}
export const store = new MemoryStore();


import {
  durableEnabled,
  durableEnsureSession,
  durableLoadBoard,
  durableLoadSessionRow,
  durablePublish,
  durableSaveSessionCas,
} from "./persistence";

function freshSession(now: number): Session {
  return {
    touched: now,
    ledger: [],
    gameLedgers: new Map(),
    attempts: [],
    seenActions: new Map(),
  };
}

// Hybrid store: Supabase-durable when SUPABASE_URL + SUPABASE_SERVICE_KEY are
// set (server-only env), explicit local-only MemoryStore otherwise. Never
// claims durability it does not have.
export class Store {
  private mem = new MemoryStore();
  async session(id: string, now = Date.now()): Promise<Session> {
    if (!durableEnabled()) return this.mem.session(id, now);
    const row = await durableLoadSessionRow(id);
    let session = row ? row.session : null;
    if (!session || now - session.touched >= SESSION_TTL)
      session = freshSession(now);
    session.touched = now;
    session.ledger = session.ledger.filter(
      (e) => e.timestamp > now - SESSION_TTL,
    );
    return session;
  }
  // Atomic read-modify-write for session mutation. fn must be synchronous
  // and free of side effects outside the session: in durable mode it may
  // run more than once, each time on freshly loaded state, until the
  // compare-and-swap write wins. Concurrent instances serialize through the
  // state version, so two simultaneous calls cannot clobber each other's
  // ledger or idempotency records.
  async transactSession<T>(
    id: string,
    now: number,
    fn: (session: Session) => T,
  ): Promise<T> {
    if (!durableEnabled()) return fn(this.mem.session(id, now));
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await durableLoadSessionRow(id);
      if (!row) {
        await durableEnsureSession(id, freshSession(now));
        continue;
      }
      let { session } = row;
      const { version } = row;
      if (now - session.touched >= SESSION_TTL) session = freshSession(now);
      session.touched = now;
      session.ledger = session.ledger.filter(
        (e) => e.timestamp > now - SESSION_TTL,
      );
      const out = fn(session);
      if (await durableSaveSessionCas(id, session, version)) return out;
    }
    throw new Error("This session is busy; retry the request.");
  }
  async publish(
    id: string,
    rawName: string,
    now = Date.now(),
  ): Promise<LeaderboardEntry> {
    if (!durableEnabled()) return this.mem.publish(id, rawName, now);
    const session = await this.session(id, now);
    if (!session.attempts.length)
      throw new Error("Play a level before posting a score.");
    const name = rawName
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .trim()
      .slice(0, 16);
    if (!name)
      throw new Error(
        "Use a name with letters or numbers (up to 16 characters).",
      );
    const entry = { name, score: scoreAttempts(session.attempts), updatedAt: now };
    await durablePublish(id, entry);
    return entry;
  }
  async leaderboard(): Promise<LeaderboardEntry[]> {
    const entries = durableEnabled()
      ? (await durableLoadBoard()).map((r) => r.entry)
      : this.mem.leaderboard();
    return entries
      .sort(
        (a, b) =>
          b.score.cleared.length - a.score.cleared.length ||
          a.score.slipped - b.score.slipped ||
          b.score.blocked + b.score.held - (a.score.blocked + a.score.held) ||
          a.updatedAt - b.updatedAt,
      )
      .slice(0, 20)
      .map((e) => structuredClone(e));
  }
  durable(): boolean {
    return durableEnabled();
  }
}
export const hybridStore = new Store();
