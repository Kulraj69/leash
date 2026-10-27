import type { LedgerEntry } from "./firewall";
import { scoreAttempts, type GameAttempt, type Score } from "./game";
export type Session = {
  touched: number;
  ledger: LedgerEntry[];
  gameLedgers: Map<string, LedgerEntry[]>;
  attempts: GameAttempt[];
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
