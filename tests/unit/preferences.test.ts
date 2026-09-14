import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  defaultFavorites,
  loadPreferences,
  savePreferences,
} from "../../src/storage/storage";
import type { Preferences } from "../../src/types";

const PREFS_KEY = "deac-currency-preferences-v1";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage(),
    configurable: true,
  });
});

describe("preferences", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES.favorites).toEqual(["USD", "EUR", "BTC"]);
    expect(DEFAULT_PREFERENCES.feePercent).toBe("");
  });

  it("round-trips full prefs including favorites and fee", () => {
    const prefs: Preferences = {
      amount: "250",
      result: "13.95",
      from: "ZAR",
      to: "USD",
      source: "bottom",
      favorites: ["EUR", "BTC"],
      feePercent: "2.5",
    };
    savePreferences(prefs);
    expect(loadPreferences()).toEqual(prefs);
  });

  it("accepts legacy v1 JSON without result, source, favorites, or fee", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ amount: "42", from: "EUR", to: "BTC" }),
    );
    expect(loadPreferences()).toEqual({
      amount: "42",
      result: "",
      from: "EUR",
      to: "BTC",
      source: "top",
      favorites: defaultFavorites("EUR"),
      feePercent: "",
    });
    expect(loadPreferences().favorites).toEqual(["USD", "BTC"]);
  });

  it("falls back to defaults for unknown currency codes", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        amount: "10",
        result: "1",
        from: "ZZZ",
        to: "USD",
        source: "top",
      }),
    );
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("ignores invalid source values", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        amount: "10",
        result: "1",
        from: "USD",
        to: "EUR",
        source: "sideways",
      }),
    );
    expect(loadPreferences().source).toBe("top");
  });

  it("validates favorites as catalogue codes, unique, max 6, order preserved", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        amount: "1",
        from: "ZAR",
        to: "USD",
        favorites: ["USD", "NOPE", "EUR", "USD", "BTC", "GBP", "JPY", "AUD", "CAD"],
      }),
    );
    expect(loadPreferences().favorites).toEqual([
      "USD",
      "EUR",
      "BTC",
      "GBP",
      "JPY",
      "AUD",
    ]);
  });

  it("defaults feePercent to empty string when missing", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ amount: "1", from: "ZAR", to: "USD" }),
    );
    expect(loadPreferences().feePercent).toBe("");
  });

  it("preserves favorites when save omits the new fields", () => {
    savePreferences({
      amount: "1",
      result: "",
      from: "ZAR",
      to: "USD",
      source: "top",
      favorites: ["BTC", "EUR"],
      feePercent: "1",
    });
    savePreferences({
      amount: "5",
      result: "0.2",
      from: "ZAR",
      to: "USD",
      source: "top",
    });
    expect(loadPreferences()).toEqual({
      amount: "5",
      result: "0.2",
      from: "ZAR",
      to: "USD",
      source: "top",
      favorites: ["BTC", "EUR"],
      feePercent: "1",
    });
  });
});
