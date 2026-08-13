import { getCurrency } from "../data/currencies";
import type { Preferences, RateTable } from "../types";

const PREFS_KEY = "deac-currency-preferences-v1";
export const DEFAULT_PREFERENCES: Preferences = {
  amount: "1",
  result: "",
  from: "ZAR",
  to: "USD",
  source: "top",
};

function isSource(value: unknown): value is Preferences["source"] {
  return value === "top" || value === "bottom";
}

export function loadPreferences(): Preferences {
  try {
    const value = JSON.parse(
      localStorage.getItem(PREFS_KEY) ?? "null",
    ) as Partial<Preferences> | null;
    if (
      !value ||
      typeof value.amount !== "string" ||
      typeof value.from !== "string" ||
      typeof value.to !== "string"
    ) {
      return DEFAULT_PREFERENCES;
    }
    if (!getCurrency(value.from) || !getCurrency(value.to)) {
      return DEFAULT_PREFERENCES;
    }
    return {
      amount: value.amount,
      result: typeof value.result === "string" ? value.result : "",
      from: value.from,
      to: value.to,
      source: isSource(value.source) ? value.source : "top",
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}
export function savePreferences(value: Preferences) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(value));
  } catch {
    /* unavailable storage is non-fatal */
  }
}

const DB = "deac-currency-cache";
const STORE = "rates";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "base" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function getCachedRates(base: string): Promise<RateTable | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(base);
      request.onsuccess = () =>
        resolve((request.result as RateTable | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}
export async function setCachedRates(table: RateTable) {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .put(table);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    /* conversion remains usable without storage */
  }
}
export async function clearRateCache() {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    /* non-fatal */
  }
}
export const isFresh = (fetchedAt: number, now = Date.now()) =>
  now - fetchedAt < 120_000;
