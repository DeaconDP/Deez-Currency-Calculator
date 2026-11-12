import { describe, expect, it } from "vitest";
import { calculate, calculateInverse } from "../../src/conversion/calculate";
import { formatResult } from "../../src/conversion/format";
import { parseAmount } from "../../src/conversion/parseAmount";
import { getCurrency } from "../../src/data/currencies";

describe("amount parsing", () => {
  it.each([
    ["12", "12"],
    ["12.5", "12.5"],
    ["12,5", "12.5"],
    ["1 234,50", "1234.50"],
    ["1,234.50", "1234.50"],
    ["1.234,50", "1234.50"],
  ])("parses %s", (input, expected) =>
    expect(parseAmount(input)).toEqual({ valid: true, normalized: expected }),
  );
  it.each(["", "-2", "1e4", "NaN", "Infinity", "1234567890123456789", "1.5.5"])(
    "rejects %s",
    (input) => expect(parseAmount(input).valid).toBe(false),
  );
  it("reads a leading separator as 0.", () =>
    expect(parseAmount(".5")).toEqual({ valid: true, normalized: "0.5" }));
  it("keeps a lone dot as the decimal point", () =>
    expect(parseAmount("1.125")).toEqual({ valid: true, normalized: "1.125" }));

  describe("with a comma-decimal locale (en-ZA, de-DE)", () => {
    it.each([
      ["0,125", "0.125"],
      ["1,125", "1.125"],
      ["1 250,5", "1250.5"],
      ["12.500", "12500"],
      ["1.234.567,89", "1234567.89"],
      ["R 1 250,50".replace("R ", ""), "1250.50"],
      ["1.5", "1.5"],
    ])("parses %s", (input, expected) =>
      expect(parseAmount(input, ",")).toEqual({ valid: true, normalized: expected }),
    );
    it.each(["1,5,5", "12.5000.1"])("rejects %s", (input) =>
      expect(parseAmount(input, ",").valid).toBe(false),
    );
  });

  describe("with a dot-decimal locale (en-US)", () => {
    it.each([
      ["1,250", "1250"],
      ["0,125", "0.125"],
      ["1,234,567.5", "1234567.5"],
      ["0.125", "0.125"],
    ])("parses %s", (input, expected) =>
      expect(parseAmount(input, ".")).toEqual({ valid: true, normalized: expected }),
    );
    it.each(["1.5.", "1.5.5"])("rejects %s", (input) =>
      expect(parseAmount(input, ".").valid).toBe(false),
    );
  });
});
describe("calculation and formatting", () => {
  it("uses exact decimal multiplication", () =>
    expect(calculate("0.1", "0.2")).toBe("0.02"));
  it("handles very small crypto values", () =>
    expect(calculate("0.00025", "59806.95199")).toBe("14.9517379975"));
  it("uses exact decimal division for inverse", () =>
    expect(calculateInverse("1", "0.0558")).toBe("17.92114695340501792115"));
  it("inverse of forward recovers the source amount", () => {
    const forward = calculate("2", "0.0558")!;
    expect(calculateInverse(forward, "0.0558")).toBe("2");
  });
  it("formats fiat without meaningless zeroes", () =>
    expect(formatResult("14.9500", getCurrency("USD")!)).toMatch(/^14[.,]95$/));
  it("formats crypto to eight decimals", () =>
    expect(formatResult("0.000012345678", getCurrency("BTC")!)).toMatch(
      /0[.,]00001235/,
    ));
});
