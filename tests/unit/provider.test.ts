import { describe, expect, it } from "vitest";
import { validateRateResponse } from "../../src/api/coinbase";
import { isFresh } from "../../src/storage/storage";

describe("provider validation", () => {
  it("accepts valid positive string rates", () =>
    expect(
      validateRateResponse(
        { data: { currency: "ZAR", rates: { USD: "0.0558" } } },
        "ZAR",
      ).rates.USD,
    ).toBe("0.0558"));
  it.each([
    { data: { currency: "USD", rates: { USD: "1" } } },
    { data: { currency: "ZAR", rates: { USD: "0" } } },
    { data: { currency: "ZAR", rates: { USD: "-1" } } },
    { data: { currency: "ZAR" } },
  ])("rejects invalid payload %#", (payload) =>
    expect(() => validateRateResponse(payload, "ZAR")).toThrow(),
  );
});
describe("cache freshness", () => {
  it("uses a two minute boundary", () => {
    expect(isFresh(0, 119999)).toBe(true);
    expect(isFresh(0, 120000)).toBe(false);
  });
});
