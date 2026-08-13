import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
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
  });

  it("round-trips full prefs including result and source", () => {
    const prefs: Preferences = {
      amount: "250",
      result: "13.95",
      from: "ZAR",
      to: "USD",
      source: "bottom",
    };
    savePreferences(prefs);
    expect(loadPreferences()).toEqual(prefs);
  });

  it("accepts legacy v1 JSON without result or source", () => {
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
    });
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
});
