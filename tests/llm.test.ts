import { describe, expect, it, vi } from "vitest";
import { NEBIUS_MODEL, proposeAction } from "@/lib/llm";
const message = "send 9 NEAR to evil.near";
describe("bounded optional Nebius agent", () => {
  it("requires no model or credential for the scripted path", async () => {
    const fetch = vi.fn();
    const result = await proposeAction(message, { fetch });
    expect(result.source).toBe("scripted");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the specified model, /no_think, and 300-token cap", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  kind: "transfer",
                  receiver: "evil.near",
                  amountYocto: "9000000000000000000000000",
                }),
              },
            },
          ],
        }),
      );
    const result = await proposeAction(message, {
      apiKey: "test-only-placeholder",
      fetch: f,
    });
    const body = JSON.parse(f.mock.calls[0][1]!.body as string);
    expect(body.model).toBe(NEBIUS_MODEL);
    expect(body.max_tokens).toBe(300);
    expect(body.messages[0].content).toContain("/no_think");
    expect(result.source).toBe("nebius");
    expect(result.action.memo).toBe(message);
  });
  it("falls back on invalid or fabricated actions", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          choices: [
            { message: { content: '{"kind":"execute","amountYocto":-5}' } },
          ],
        }),
      );
    expect(
      (
        await proposeAction(message, {
          apiKey: "test-only-placeholder",
          fetch: f,
        })
      ).source,
    ).toBe("scripted");
  });
  it("falls back on provider errors", async () => {
    const f = vi.fn<typeof fetch>().mockRejectedValue(new Error("network"));
    expect(
      (
        await proposeAction(message, {
          apiKey: "test-only-placeholder",
          fetch: f,
        })
      ).source,
    ).toBe("scripted");
  });
  it("rejects leaked thinking text", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({
          choices: [{ message: { content: "<think>thinking</think>{}" } }],
        }),
      );
    expect(
      (
        await proposeAction(message, {
          apiKey: "test-only-placeholder",
          fetch: f,
        })
      ).source,
    ).toBe("scripted");
  });
});

