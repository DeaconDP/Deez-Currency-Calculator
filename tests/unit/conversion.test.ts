import { describe, expect, it } from "vitest";
import { calculate } from "../../src/conversion/calculate";
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
  it.each(["", "-2", "1e4", "NaN", "Infinity", "1234567890123456789"])(
    "rejects %s",
    (input) => expect(parseAmount(input).valid).toBe(false),
  );
});
describe("calculation and formatting", () => {
  it("uses exact decimal multiplication", () =>
    expect(calculate("0.1", "0.2")).toBe("0.02"));
  it("handles very small crypto values", () =>
    expect(calculate("0.00025", "59806.95199")).toBe("14.9517379975"));
  it("formats fiat without meaningless zeroes", () =>
    expect(formatResult("14.9500", getCurrency("USD")!)).toMatch(/^14[.,]95$/));
  it("formats crypto to eight decimals", () =>
    expect(formatResult("0.000012345678", getCurrency("BTC")!)).toMatch(
      /0[.,]00001235/,
    ));
});
