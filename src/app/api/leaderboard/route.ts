import { api, body, json, sessionId, textField } from "@/lib/http";
import { store } from "@/lib/store";
export async function GET(request: Request) {
  return api(request, () =>
    json({
      entries: store.leaderboard(),
      note: "In-memory demo scores; resets when the server restarts.",
    }),
  );
}
export async function POST(request: Request) {
  return api(request, async () => {
    const data = await body(request);
    const entry = store.publish(
      sessionId(data.sessionId),
      textField(data.name, "Name", 16),
    );
    return json({ entry, entries: store.leaderboard() });
  });
}

