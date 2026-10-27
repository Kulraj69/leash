// Adapted from qloo. Memory is per serverless instance, not a distributed hard cap.
export const PER_IP_LIMIT = 30;
export const DAILY_LIMIT = 3000;
export type LimitResult =
  | { ok: true; remaining: number }
  | { ok: false; note: string; retryAfter: number };
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private day = "";
  private count = 0;
  constructor(
    private perIp = PER_IP_LIMIT,
    private windowMs = 3_600_000,
    private daily = DAILY_LIMIT,
  ) {}
  take(ip: string, now = Date.now()): LimitResult {
    const today = new Date(now).toISOString().slice(0, 10);
    if (this.day !== today) {
      this.day = today;
      this.count = 0;
    }
    for (const [key, times] of this.hits)
      if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(key);
    if (this.count >= this.daily)
      return {
        ok: false,
        note: "The terminal has reached its 3,000 requests for today. Please return after midnight UTC.",
        retryAfter: Math.max(
          1,
          Math.ceil(
            (Date.parse(`${today}T00:00:00Z`) + 86_400_000 - now) / 1000,
          ),
        ),
      };
    const recent = (this.hits.get(ip) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    if (recent.length >= this.perIp)
      return {
        ok: false,
        note: "Give the terminal a breather. You've used 30 requests this hour; try again when a slot frees up.",
        retryAfter: Math.max(
          1,
          Math.ceil((recent[0] + this.windowMs - now) / 1000),
        ),
      };
    recent.push(now);
    this.hits.set(ip, recent);
    this.count++;
    return { ok: true, remaining: this.perIp - recent.length };
  }
}
export function clientIp(request: Request): string {
  if (process.env.VERCEL)
    return (
      request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() ||
      "unknown"
    );
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}
export const limiter = new RateLimiter();
