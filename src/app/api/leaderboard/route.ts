import { api, body, json, sessionId, textField } from "@/lib/http";
import { hybridStore } from "@/lib/store";
export async function GET(request: Request) {
  return api(request, async () =>
    json({
      entries: await hybridStore.leaderboard(),
      note: hybridStore.durable()
        ? "Scores persist in the project database."
        : "Local-only demo scores on this server instance; they reset on restart and are not shared across instances.",
    }),
  );
}
export async function POST(request: Request) {
  return api(request, async () => {
    const data = await body(request);
    const entry = await hybridStore.publish(
      sessionId(data.sessionId),
      textField(data.name, "Name", 16),
    );
    return json({ entry, entries: await hybridStore.leaderboard() });
  });
}
