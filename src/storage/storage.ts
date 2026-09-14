import { normalizeFavorites } from "../conversion/glance";
import { getCurrency } from "../data/currencies";
import type { Preferences, RateTable } from "../types";

const PREFS_KEY = "deac-currency-preferences-v1";
const DEFAULT_FAVORITE_CODES = ["USD", "EUR", "BTC"];

export function defaultFavorites(from: string): string[] {
  return normalizeFavorites(
    DEFAULT_FAVORITE_CODES.filter((code) => getCurrency(code) && code !== from),
  );
}

function sanitizeFavorites(codes: unknown, from: string): string[] {
  if (!Array.isArray(codes)) return defaultFavorites(from);
  const valid = codes.filter(
    (code): code is string => typeof code === "string" && !!getCurrency(code),
  );
  const normalized = normalizeFavorites(valid);
  return normalized.length > 0 ? normalized : defaultFavorites(from);
}

function sanitizeFeePercent(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export const DEFAULT_PREFERENCES: Preferences = {
  amount: "1",
  result: "",
  from: "ZAR",
  to: "USD",
  source: "top",
  favorites: defaultFavorites("ZAR"),
  feePercent: "",
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
      favorites: sanitizeFavorites(value.favorites, value.from),
      feePercent: sanitizeFeePercent(value.feePercent),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

type PreferencesWrite = Omit<Preferences, "favorites" | "feePercent"> &
  Partial<Pick<Preferences, "favorites" | "feePercent">>;

export function savePreferences(value: PreferencesWrite) {
  try {
    const previous = loadPreferences();
    const favorites =
      value.favorites !== undefined
        ? sanitizeFavorites(value.favorites, value.from)
        : previous.favorites;
    const feePercent =
      value.feePercent !== undefined
        ? sanitizeFeePercent(value.feePercent)
        : previous.feePercent;
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        amount: value.amount,
        result: value.result,
        from: value.from,
        to: value.to,
        source: value.source,
        favorites,
        feePercent,
      } satisfies Preferences),
    );
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
