import { levelById, playTurn, scoreAttempts } from "@/lib/game";
import { api, body, HttpError, json, sessionId, textField } from "@/lib/http";
import { proposeAction } from "@/lib/llm";
import { hybridStore } from "@/lib/store";
export async function POST(request: Request) {
  return api(request, async () => {
    const data = await body(request);
    if (
      !Number.isInteger(data.level) ||
      (data.applyFix !== undefined && typeof data.applyFix !== "boolean")
    )
      throw new HttpError(400, "Choose a level and a valid fix toggle.");
    const id = sessionId(data.sessionId),
      message = textField(data.message, "Message", 1000),
      level = levelById(Number(data.level));
    const fixed = data.applyFix === true;
    const proposal = await proposeAction(message, {
      apiKey: process.env.NEBIUS_API_KEY,
    });
    // Mutate the session AFTER any model await, inside the atomic
    // transaction: evaluation and ledger reservation stay synchronous.
    const { turn, attempts } = await hybridStore.transactSession(
      id,
      Date.now(),
      (session) => {
        if (session.attempts.length >= 200)
          throw new HttpError(
            400,
            "This session has 200 turns. Start a new game session.",
          );
        const key = `${level.id}:${fixed}`;
        const ledger = session.gameLedgers.get(key) ?? [...level.ledger];
        const turn = playTurn(level, proposal.action, ledger, fixed);
        if (turn.result.verdict === "ALLOW")
          ledger.push({
            timestamp: level.now,
            amountYocto: proposal.action.amountYocto,
          });
        session.gameLedgers.set(key, ledger);
        session.attempts.push({
          level: level.id,
          harmful: turn.harmful,
          verdict: turn.result.verdict,
          fixed,
        });
        return { turn, attempts: session.attempts };
      },
    );
    const score = scoreAttempts(attempts);
    return json({
      ...proposal,
      ...turn,
      score,
      clearedByLeash: score.cleared.includes(level.id),
      fixed,
      scenarioTime: new Date(level.now).toISOString(),
    });
  });
}
