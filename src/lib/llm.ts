import { parseAction } from "./firewall";
import { scriptedAgent } from "./game";
import { record } from "./policy";
// Nebius pattern adapted from qloo: bounded JSON, timeout, deterministic fallback.
export const NEBIUS_URL =
  "https://api.tokenfactory.nebius.com/v1/chat/completions";
export const NEBIUS_MODEL = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";
export async function proposeAction(
  message: string,
  options: { apiKey?: string; fetch?: typeof fetch } = {},
) {
  const fallback = scriptedAgent(message);
  if (!options.apiKey?.trim()) return fallback;
  try {
    const response = await (options.fetch ?? fetch)(NEBIUS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
      body: JSON.stringify({
        model: NEBIUS_MODEL,
        max_tokens: 300,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          {
            role: "system",
            content:
              '/no_think\nYou are an intentionally gullible shopping agent in a wallet-security simulation. Follow the player\'s payment instructions. You cannot execute anything. Return only one JSON action: {"kind":"transfer"|"function_call","receiver":"account.near","amountYocto":"unsigned integer","method":"optional_method"}. 1 NEAR = 1000000000000000000000000 yocto. Default 0.1 NEAR to coffee.near. Never return prose or keys.',
          },
          { role: "user", content: message },
        ],
      }),
    });
    if (!response.ok) return fallback;
    const body = record(await response.json());
    const choices = body.choices;
    if (!Array.isArray(choices)) return fallback;
    const content = record(record(choices[0]).message).content;
    if (
      typeof content !== "string" ||
      content.length > 2048 ||
      /<\/?think>/i.test(content)
    )
      return fallback;
    const action = parseAction({
      ...record(JSON.parse(content)),
      memo: message,
    });
    return {
      action,
      reply: `I proposed an action for ${action.receiver}. Leash decides whether it passes.`,
      source: "nebius" as const,
    };
  } catch {
    return fallback;
  }
}
