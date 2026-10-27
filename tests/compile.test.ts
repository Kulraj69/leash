import { describe, expect, it } from "vitest";
import { compile, compileAccessKey } from "@/lib/compile";
import { parseNear, PRESETS } from "@/lib/policy";

describe("deterministic English compiler", () => {
  it("compiles the complete requested grammar", () => {
    const { policy: p, unparsed } = compile(
      "max 2 NEAR a day, never more than 0.5 NEAR per payment, only pay weather.near and coffee.near, ask me above 0.3 NEAR, no more than 5 payments an hour, only between 9am and 9pm",
    );
    expect(unparsed).toEqual([]);
    expect(p.dailyBudgetYocto).toBe(parseNear("2"));
    expect(p.perTxCapYocto).toBe(parseNear("0.5"));
    expect(p.allowlist).toEqual(["coffee.near", "weather.near"]);
    expect(p.askHumanAboveYocto).toBe(parseNear("0.3"));
    expect(p.maxTxPerHour).toBe(5);
    expect(p.activeHours).toEqual({
      start: 540,
      end: 1260,
      timezone: "Asia/Kolkata",
    });
  });
  it.each(PRESETS)("compiles $name with no loss", (preset) =>
    expect(compile(preset.text).unparsed).toEqual([]),
  );
  it("accepts newline rules and dotted account names", () =>
    expect(
      compile("only pay api.weather.near\nmax 1 NEAR per day").policy.allowlist,
    ).toEqual(["api.weather.near"]));
  it("accepts multiple comma-separated receivers", () =>
    expect(
      compile("only pay coffee.near, weather.near and books.near").policy
        .allowlist,
    ).toHaveLength(3));
  it("accepts a period between clauses without splitting decimals", () =>
    expect(
      compile("max 2.5 NEAR a day. ask me above 0.3 NEAR.").unparsed,
    ).toEqual([]));
  it("allows zero for explicit deny budgets", () =>
    expect(compile("max 0 NEAR a day").policy.dailyBudgetYocto).toBe(0n));
  it("parses overnight IST hours and noon/midnight", () => {
    expect(
      compile("only between 9pm and 9am").policy.activeHours,
    ).toMatchObject({ start: 1260, end: 540 });
    expect(
      compile("only between 12am and 12pm").policy.activeHours,
    ).toMatchObject({ start: 0, end: 720 });
  });
  it("rejects invalid clocks as unparsed", () =>
    expect(compile("only between 13am and 9pm").unparsed).toEqual([
      "only between 13am and 9pm",
    ]));
  it("parses methods, tokens, and accumulating block clauses", () => {
    const { policy, unparsed } = compile(
      "only methods brew and menu on coffee.near; only tokens NEAR and wrap.testnet; block evil.near; never pay bad.near",
    );
    expect(unparsed).toEqual([]);
    expect(policy.allowedMethods["coffee.near"]).toEqual(["brew", "menu"]);
    expect(policy.allowedTokens).toEqual(["NEAR", "wrap.testnet"]);
    expect(policy.blockedReceivers).toEqual(["bad.near", "evil.near"]);
  });
  it("does not partially accept unsupported qualifiers", () => {
    const result = compile("max 2 NEAR a day except on Sundays; be careful");
    expect(result.unparsed).toHaveLength(2);
  });
  it("reports malformed amounts and unicode receivers", () =>
    expect(
      compile("max -2 NEAR a day; only pay coffee.nеar").unparsed,
    ).toHaveLength(2));
  it("is deterministic and independent of previous calls", () => {
    compile("max 9 NEAR a day");
    expect(compile(PRESETS[0].text)).toEqual(compile(PRESETS[0].text));
  });
  it("documents last recognized setting wins", () =>
    expect(
      compile("max 2 NEAR a day; max 1 NEAR a day").policy.dailyBudgetYocto,
    ).toBe(parseNear("1")));
});
describe("NEAR function-call access key compilation", () => {
  it("emits one key for one receiver and the exact CLI shape", () => {
    const { keys } = compileAccessKey(
      compile("only pay coffee.near; only methods brew on coffee.near").policy,
    );
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      receiver_id: "coffee.near",
      method_names: ["brew"],
      allowance: parseNear("2").toString(),
    });
    expect(keys[0].command).toBe(
      "near account add-key YOUR_ACCOUNT.testnet grant-function-call-access --allowance '2 NEAR' --receiver-account-id 'coffee.near' --method-names 'brew' use-manually-provided-public-key YOUR_PUBLIC_KEY network-config testnet sign-with-keychain send",
    );
  });
  it("splits multiple receivers into separate keys", () => {
    const result = compileAccessKey(compile(PRESETS[0].text).policy);
    expect(result.keys).toHaveLength(2);
    expect(result.notes.join(" ")).toContain(
      "One receiver per function-call key",
    );
  });
  it("does not encode wildcards as on-chain receivers", () => {
    const result = compileAccessKey(compile("only pay *.coffee.near").policy);
    expect(result.keys).toHaveLength(0);
    expect(result.notes.join(" ")).toContain("Wildcard");
  });
  it("does not generate keys for blocked accounts", () =>
    expect(
      compileAccessKey(
        compile("only pay coffee.near; block coffee.near").policy,
      ).keys,
    ).toEqual([]));
  it("warns that empty methods allow all and allowance covers gas", () => {
    const result = compileAccessKey(compile("only pay coffee.near").policy);
    expect(result.keys[0].method_names).toEqual([]);
    expect(result.notes.join(" ")).toContain("ALL contract methods");
    expect(result.notes.join(" ")).toContain("gas fees, not transferred value");
  });
  it("does not translate deny-all methods into allow-all keys", () => {
    const p = compile("only pay coffee.near").policy;
    p.allowedMethods["coffee.near"] = [];
    expect(compileAccessKey(p).keys).toEqual([]);
  });
  it("intersects exact and suffix method constraints", () => {
    const p = compile(
      "only pay shop.coffee.near; only methods brew and menu on *.coffee.near; only methods menu on shop.coffee.near",
    ).policy;
    expect(compileAccessKey(p).keys[0].method_names).toEqual(["menu"]);
  });
  it("refuses unrestricted allowance or receivers", () => {
    const p = compile("only pay coffee.near").policy;
    p.dailyBudgetYocto = null;
    expect(compileAccessKey(p).keys).toEqual([]);
    p.allowlist = null;
    expect(compileAccessKey(p).keys).toEqual([]);
  });
});
