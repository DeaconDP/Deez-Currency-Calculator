import { describe, expect, it } from "vitest";
import {
  buildGlanceRows,
  normalizeFavorites,
} from "../../src/conversion/glance";
import type { RateTable } from "../../src/types";

const table: RateTable = {
  base: "ZAR",
  rates: {
    USD: "0.055",
    EUR: "0.05",
    BTC: "0.000001",
    GBP: "0.043",
  },
  fetchedAt: 1_700_000_000_000,
  provider: "coinbase",
};

describe("normalizeFavorites", () => {
  it("trims, dedupes, preserves order, and caps at 6", () => {
    expect(
      normalizeFavorites([
        " USD ",
        "EUR",
        "USD",
        "",
        "BTC",
        "GBP",
        "JPY",
        "AUD",
        "CAD",
      ]),
    ).toEqual(["USD", "EUR", "BTC", "GBP", "JPY", "AUD"]);
  });
});

describe("buildGlanceRows", () => {
  it("projects favorites through the rate table with fee", () => {
    expect(
      buildGlanceRows({
        baseAmount: "100",
        favorites: ["USD", "EUR"],
        table,
        feePercent: "10",
        excludeCodes: ["ZAR"],
      }),
    ).toEqual([
      {
        code: "USD",
        ok: true,
        raw: "5.5",
        display: "4.95",
      },
      {
        code: "EUR",
        ok: true,
        raw: "5",
        display: "4.5",
      },
    ]);
  });

  it("excludes codes and marks missing rates unavailable", () => {
    expect(
      buildGlanceRows({
        baseAmount: "10",
        favorites: ["USD", "ZAR", "CHF"],
        table,
        feePercent: "",
        excludeCodes: ["ZAR"],
      }),
    ).toEqual([
      {
        code: "USD",
        ok: true,
        raw: "0.55",
        display: "0.55",
      },
      {
        code: "CHF",
        ok: false,
        reason: "unavailable",
        display: null,
      },
    ]);
  });

  it("marks every row invalid-amount when the base amount fails", () => {
    expect(
      buildGlanceRows({
        baseAmount: "",
        favorites: ["USD", "EUR"],
        table,
        feePercent: "",
        excludeCodes: ["ZAR"],
      }),
    ).toEqual([
      {
        code: "USD",
        ok: false,
        reason: "invalid-amount",
        display: null,
      },
      {
        code: "EUR",
        ok: false,
        reason: "invalid-amount",
        display: null,
      },
    ]);
  });

  it("marks unknown currency codes", () => {
    expect(
      buildGlanceRows({
        baseAmount: "1",
        favorites: ["ZZZ"],
        table,
        feePercent: "",
      }),
    ).toEqual([
      {
        code: "ZZZ",
        ok: false,
        reason: "unknown-currency",
        display: null,
      },
    ]);
  });
});
