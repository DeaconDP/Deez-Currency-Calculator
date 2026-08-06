import type { ExchangeRateProvider, RateTable } from "../types";
import { isPositiveDecimal } from "../conversion/calculate";

const ENDPOINT = "https://api.coinbase.com/v2/exchange-rates?currency=";

export function validateRateResponse(
  input: unknown,
  requestedBase: string,
): RateTable {
  if (!input || typeof input !== "object" || !("data" in input))
    throw new Error("The rate provider returned an invalid response.");
  const data = (input as { data?: unknown }).data;
  if (!data || typeof data !== "object")
    throw new Error("The rate provider returned an invalid response.");
  const raw = data as { currency?: unknown; rates?: unknown };
  if (
    raw.currency !== requestedBase ||
    !raw.rates ||
    typeof raw.rates !== "object" ||
    Array.isArray(raw.rates)
  )
    throw new Error("The rate provider returned an invalid rate table.");
  const rates: Record<string, string> = {};
  for (const [code, value] of Object.entries(raw.rates))
    if (/^[A-Z0-9]{2,10}$/.test(code) && isPositiveDecimal(value))
      rates[code] = value;
  if (!Object.keys(rates).length)
    throw new Error("No valid rates were returned.");
  return {
    base: requestedBase,
    rates,
    fetchedAt: Date.now(),
    provider: "Coinbase",
  };
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export class CoinbaseProvider implements ExchangeRateProvider {
  async getRates(
    baseCurrency: string,
    externalSignal?: AbortSignal,
  ): Promise<RateTable> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const abort = () => controller.abort();
      externalSignal?.addEventListener("abort", abort, { once: true });
      try {
        const response = await fetch(
          `${ENDPOINT}${encodeURIComponent(baseCurrency)}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );
        if (!response.ok) {
          const error = new Error(`Rate request failed (${response.status}).`);
          if (response.status >= 400 && response.status < 500)
            throw Object.assign(error, { noRetry: true });
          throw error;
        }
        return validateRateResponse(await response.json(), baseCurrency);
      } catch (error) {
        lastError = error;
        if ((error as { noRetry?: boolean }).noRetry || externalSignal?.aborted)
          throw error;
        if (attempt === 0) await delay(350, externalSignal);
      } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener("abort", abort);
      }
    }
    throw lastError instanceof Error && lastError.name !== "AbortError"
      ? lastError
      : new Error("The rate request timed out.");
  }
}
