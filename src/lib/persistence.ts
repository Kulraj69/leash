import { stringify } from "./policy";
import type { LeaderboardEntry, Session } from "./store";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Server-only secret: never prefix with NEXT_PUBLIC_, never import from client components.
export function durableEnabled(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_SERVICE_KEY!,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY!}`,
    ...extra,
  };
}

type LedgerJson = { amountYocto: string; timestamp: number };
type SessionJson = {
  touched: number;
  ledger: LedgerJson[];
  gameLedgers: [string, LedgerJson[]][];
  attempts: Session["attempts"];
};

function packSession(session: Session): SessionJson {
  return JSON.parse(
    stringify({
      touched: session.touched,
      ledger: session.ledger,
      gameLedgers: [...session.gameLedgers],
      attempts: session.attempts,
    }),
  ) as SessionJson;
}

function unpackSession(state: SessionJson): Session {
  return {
    touched: state.touched,
    ledger: state.ledger.map((e) => ({
      amountYocto: BigInt(e.amountYocto),
      timestamp: e.timestamp,
    })),
    gameLedgers: new Map(
      state.gameLedgers.map(([k, entries]) => [
        k,
        entries.map((e) => ({
          amountYocto: BigInt(e.amountYocto),
          timestamp: e.timestamp,
        })),
      ]),
    ),
    attempts: state.attempts,
  };
}

async function rest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: headers({
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string>),
    }),
    cache: "no-store",
  });
  if (!res.ok)
    throw new Error(`Supabase ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

export async function durableLoadSession(id: string): Promise<Session | null> {
  const res = await rest(
    `leash_sessions?id=eq.${encodeURIComponent(id)}&select=state`,
  );
  const rows = (await res.json()) as { state: SessionJson }[];
  if (!rows.length) return null;
  return unpackSession(rows[0].state);
}

export async function durableSaveSession(
  id: string,
  session: Session,
): Promise<void> {
  await rest("leash_sessions", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: stringify({ id, state: packSession(session) }),
  });
}

type BoardRow = { sid: string; player: string; detail: LeaderboardEntry };

export async function durableLoadBoard(): Promise<
  { id: string; entry: LeaderboardEntry }[]
> {
  const res = await rest("leash_leaderboard?select=sid,player,detail&limit=100");
  const rows = (await res.json()) as BoardRow[];
  return rows.map((r) => ({ id: r.sid, entry: r.detail }));
}

export async function durablePublish(
  id: string,
  entry: LeaderboardEntry,
): Promise<void> {
  await rest("leash_leaderboard", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: stringify({
      sid: id,
      player: entry.name,
      score: entry.score.cleared.length,
      detail: entry,
    }),
  });
}
