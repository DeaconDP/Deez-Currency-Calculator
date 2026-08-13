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
  result: string;
  from: string;
  to: string;
  source: "top" | "bottom";
}

export type DesignFont = "pixel" | "system";
export type DesignPresetId =
  | "default"
  | "compact"
  | "high-contrast"
  | "soft"
  | "neon"
  | "custom";

export interface DesignTheme {
  presetId: DesignPresetId;
  background: string;
  surface: string;
  control: string;
  controlText: string;
  text: string;
  muted: string;
  money: string;
  error: string;
  focus: string;
  uiScale: number;
  font: DesignFont;
  radius: number;
  space: number;
  controlHeight: number;
}
