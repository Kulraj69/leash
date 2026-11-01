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
  v?: number;
  touched: number;
  ledger: LedgerJson[];
  gameLedgers: [string, LedgerJson[]][];
  attempts: Session["attempts"];
  seenActions?: [string, unknown][];
};

function packSession(session: Session, version: number): SessionJson {
  return JSON.parse(
    stringify({
      v: version,
      touched: session.touched,
      ledger: session.ledger,
      gameLedgers: [...session.gameLedgers],
      attempts: session.attempts,
      seenActions: [...session.seenActions],
    }),
  ) as SessionJson;
}

function unpackSession(state: SessionJson): { session: Session; version: number } {
  return {
    session: {
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
      seenActions: new Map(state.seenActions ?? []),
    },
    version: state.v ?? 0,
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

export async function durableLoadSessionRow(
  id: string,
): Promise<{ session: Session; version: number } | null> {
  const res = await rest(
    `leash_sessions?id=eq.${encodeURIComponent(id)}&select=state`,
  );
  const rows = (await res.json()) as { state: SessionJson }[];
  if (!rows.length) return null;
  return unpackSession(rows[0].state);
}

export async function durableLoadSession(id: string): Promise<Session | null> {
  const row = await durableLoadSessionRow(id);
  return row ? row.session : null;
}

// Insert the row only if it does not exist yet; concurrent creators both
// succeed here and converge through the CAS retry loop.
export async function durableEnsureSession(
  id: string,
  session: Session,
): Promise<void> {
  await rest("leash_sessions", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: stringify({ id, state: packSession(session, 0) }),
  });
}

// Compare-and-swap: the update lands only if the row still holds the state
// version this session was read with. A lost race returns false so the
// caller can reload and retry the whole operation on fresh state - this is
// what makes concurrent cross-instance evaluate calls atomic instead of
// read-modify-write clobbers. PostgREST evaluates the state->>v filter
// inside the single UPDATE, so the check and the write are one statement.
export async function durableSaveSessionCas(
  id: string,
  session: Session,
  expectedVersion: number,
): Promise<boolean> {
  const filter = encodeURIComponent("state->>v");
  const res = await rest(
    `leash_sessions?id=eq.${encodeURIComponent(id)}&${filter}=eq.${expectedVersion}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: stringify({ state: packSession(session, expectedVersion + 1) }),
    },
  );
  const rows = (await res.json()) as unknown[];
  return rows.length === 1;
}

// Last-write-wins upsert, kept for non-evaluate writes (leaderboard publish
// reads only). The evaluate and game-turn paths use transactSession instead.
export async function durableSaveSession(
  id: string,
  session: Session,
): Promise<void> {
  await rest("leash_sessions", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: stringify({ id, state: packSession(session, 0) }),
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
