export interface CurrencyDefinition {
  code: string;
  name: string;
  type: "fiat" | "crypto";
  decimals: number;
}
export interface RateTable {
  base: string;
  rates: Record<string, string>;
  fetchedAt: number;
  provider: string;
}
export interface ExchangeRateProvider {
  getRates(baseCurrency: string, signal?: AbortSignal): Promise<RateTable>;
}
export type AppStatus =
  | "loading"
  | "refreshing"
  | "fresh"
  | "stale"
  | "offline"
  | "error";
export interface Preferences {
  amount: string;
  from: string;
  to: string;
}
