import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, RateLimiter } from "@/lib/rate-limit";
const now = Date.parse("2026-11-01T12:00:00Z");
afterEach(() => vi.unstubAllEnvs());
describe("in-memory request limiter", () => {
  it("allows 30 hourly requests and politely refuses request 31", () => {
    const l = new RateLimiter();
    for (let i = 0; i < 30; i++) expect(l.take("a", now).ok).toBe(true);
    expect(l.take("a", now)).toMatchObject({ ok: false, retryAfter: 3600 });
  });
  it("isolates IPs", () => {
    const l = new RateLimiter(1);
    l.take("a", now);
    expect(l.take("b", now).ok).toBe(true);
  });
  it("releases a slot at the exact hourly boundary", () => {
    const l = new RateLimiter(1);
    l.take("a", now);
    expect(l.take("a", now + 3_600_000).ok).toBe(true);
  });
  it("enforces 3000 per UTC day across IPs", () => {
    const l = new RateLimiter();
    for (let i = 0; i < 3000; i++) expect(l.take(String(i), now).ok).toBe(true);
    expect(l.take("fresh", now)).toMatchObject({
      ok: false,
      retryAfter: 43200,
    });
  });
  it("resets the global day cap at UTC midnight", () => {
    const l = new RateLimiter(30, 3_600_000, 1);
    l.take("a", now);
    expect(l.take("a", now + 86_400_000).ok).toBe(true);
  });
  it("rejections do not consume global slots", () => {
    const l = new RateLimiter(1, 3_600_000, 2);
    l.take("a", now);
    l.take("a", now);
    expect(l.take("b", now).ok).toBe(true);
  });
  it("trusts Vercel's overwritten header on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(
      clientIp(
        new Request("http://localhost", {
          headers: {
            "x-vercel-forwarded-for": "1.2.3.4",
            "x-forwarded-for": "spoof",
          },
        }),
      ),
    ).toBe("1.2.3.4");
  });
  it("uses the configured reverse proxy header locally", () => {
    vi.stubEnv("VERCEL", "");
    expect(
      clientIp(
        new Request("http://localhost", {
          headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
        }),
      ),
    ).toBe("1.2.3.4");
  });
});

