import { createHash } from "node:crypto";
import { evaluate, parseAction } from "@/lib/firewall";
import { api, body, HttpError, json, sessionId } from "@/lib/http";
import { parsePolicy, stringify } from "@/lib/policy";
import { hybridStore } from "@/lib/store";

// Hard cap on stored idempotency keys per session. When the cap is reached
// new requestIds are REFUSED - keys are never silently evicted, because an
// evicted key would let an old retry spend again.
function maxSeenActions(): number {
  const raw = Number(process.env.LEASH_MAX_SEEN_ACTIONS);
  return Number.isInteger(raw) && raw > 0 ? raw : 2000;
}

// Optional idempotency key: a client-generated id for one intended action.
// The key binds to the exact action + policy payload: retrying the same
// requestId with the same payload returns the first verdict without
// reserving budget again, retrying it with a DIFFERENT payload is a 409,
// and omitting it keeps every call a distinct new action.
function requestId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{8,72}$/.test(value))
    throw new HttpError(
      400,
      "requestId must be 8-72 letters, digits or dashes.",
    );
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function payloadHash(action: unknown, policy: unknown): string {
  return createHash("sha256")
    .update(canonical({ action, policy }))
    .digest("hex");
}

type SeenRecord = { h?: string; r?: unknown };

export async function POST(request: Request) {
  return api(request, async () => {
    const data = await body(request);
    const id = sessionId(data.sessionId),
      action = parseAction(data.action),
      policy = parsePolicy(data.policy),
      reqId = requestId(data.requestId);
    const hash = reqId ? payloadHash(data.action, data.policy) : undefined;
    const now = Date.now();
    const out = await hybridStore.transactSession(id, now, (session) => {
      if (reqId) {
        const seen = session.seenActions.get(reqId);
        if (seen) {
          const record = seen as SeenRecord;
          // Records written before payload binding carry the bare result.
          if (record.h === undefined)
            return { result: seen, duplicate: true };
          if (record.h !== hash)
            throw new HttpError(
              409,
              "requestId was already used with a different payload; use a new requestId for a new action.",
            );
          return { result: record.r, duplicate: true };
        }
      }
      const result = evaluate(action, policy, session.ledger, now);
      if (result.verdict === "ALLOW")
        session.ledger.push({ timestamp: now, amountYocto: action.amountYocto });
      if (reqId) {
        if (session.seenActions.size >= maxSeenActions())
          throw new HttpError(
            429,
            "This session stored the maximum number of requestIds; start a new session or omit requestId.",
          );
        session.seenActions.set(reqId, {
          h: hash,
          r: JSON.parse(stringify(result)),
        });
      }
      return { result, duplicate: false };
    });
    const result = out.result as Record<string, unknown>;
    return json(
      out.duplicate
        ? { ...result, duplicate: true, sessionId: id }
        : { ...result, sessionId: id },
    );
  });
}
