import { evaluate, parseAction } from "@/lib/firewall";
import { api, body, json, sessionId } from "@/lib/http";
import { parsePolicy } from "@/lib/policy";
import { hybridStore } from "@/lib/store";
export async function POST(request: Request) {
  return api(request, async () => {
    const data = await body(request);
    const id = sessionId(data.sessionId),
      action = parseAction(data.action),
      policy = parsePolicy(data.policy);
    const now = Date.now(),
      session = await hybridStore.session(id, now);
    const result = evaluate(action, policy, session.ledger, now);
    if (result.verdict === "ALLOW")
      session.ledger.push({ timestamp: now, amountYocto: action.amountYocto });
    await hybridStore.saveSession(id, session);
    return json({ ...result, sessionId: id });
  });
}

