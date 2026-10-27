import { describe, expect, it } from "vitest";
import {
  defaultPolicy,
  formatNear,
  isAccountId,
  matchesReceiver,
  MAX_U128,
  parseNear,
  parsePolicy,
  stringify,
  YOCTO,
  yocto,
} from "@/lib/policy";

describe("exact yoctoNEAR arithmetic", () => {
  it("defines 24 decimal places", () =>
    expect(YOCTO).toBe(1000000000000000000000000n));
  it.each([
    "0",
    "1",
    "0.1",
    "0.000000000000000000000001",
    "9999999.123456789123456789123456",
  ])("round trips %s without precision loss", (amount) =>
    expect(formatNear(parseNear(amount))).toBe(amount),
  );
  it("normalizes leading and trailing zeros", () =>
    expect(formatNear(parseNear("001.2300"))).toBe("1.23"));
  it("sums decimal tenths exactly", () =>
    expect(parseNear("0.1") + parseNear("0.2")).toBe(parseNear("0.3")));
  it.each([
    "-1",
    "1e24",
    "Infinity",
    "NaN",
    "",
    ".1",
    "1.0000000000000000000000001",
    "1,000",
    "1NEAR",
  ])("rejects malformed amount %s", (value) =>
    expect(() => parseNear(value)).toThrow(),
  );
  it("bounds u128", () => {
    expect(yocto(MAX_U128.toString())).toBe(MAX_U128);
    expect(() => yocto((MAX_U128 + 1n).toString())).toThrow();
  });
  it("formats signed deltas without losing precision", () =>
    expect(formatNear(-1n)).toBe("-0.000000000000000000000001"));
  it("rejects numeric wire amounts", () =>
    expect(() => yocto(1000000)).toThrow());
});
describe("policy validation", () => {
  it("round trips bigint policies over JSON", () =>
    expect(parsePolicy(JSON.parse(stringify(defaultPolicy())))).toEqual(
      defaultPolicy(),
    ));
  it("denies receivers by default", () =>
    expect(defaultPolicy().allowlist).toEqual([]));
  it.each(["coffee.near", "test-account.testnet", "ab", "a".repeat(64)])(
    "accepts valid NEAR ID %s",
    (id) => expect(isAccountId(id)).toBe(true),
  );
  it.each([
    "A.near",
    "a",
    "coffee.nеar",
    "foo..near",
    "-foo.near",
    "foo_.near",
    "a".repeat(65),
  ])("rejects invalid NEAR ID %s", (id) => expect(isAccountId(id)).toBe(false));
  it("matches suffixes only across dot boundaries", () => {
    expect(matchesReceiver("bar.coffee.near", "*.coffee.near")).toBe(true);
    expect(matchesReceiver("coffee.near", "*.coffee.near")).toBe(false);
    expect(matchesReceiver("evilcoffee.near", "*.coffee.near")).toBe(false);
  });
  it("rejects bad active hours", () =>
    expect(() =>
      parsePolicy(
        JSON.parse(
          stringify({
            ...defaultPolicy(),
            activeHours: { start: 540, end: 540, timezone: "Asia/Kolkata" },
          }),
        ),
      ),
    ).toThrow());
  it("rejects missing required fields", () =>
    expect(() => parsePolicy({})).toThrow());
  it("rejects negative rate limits", () =>
    expect(() =>
      parsePolicy(
        JSON.parse(stringify({ ...defaultPolicy(), maxTxPerHour: -1 })),
      ),
    ).toThrow());
  it("rejects a shell payload in policy receivers", () =>
    expect(() =>
      parsePolicy(
        JSON.parse(
          stringify({
            ...defaultPolicy(),
            allowlist: ["coffee.near'; echo hi"],
          }),
        ),
      ),
    ).toThrow());
});
