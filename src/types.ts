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
  favorites: string[];
  feePercent: string;
}

export type GlanceRow =
  | {
      code: string;
      ok: true;
      raw: string;
      display: string;
    }
  | {
      code: string;
      ok: false;
      reason: "unavailable" | "invalid-amount" | "unknown-currency";
      display: null;
    };

export interface StatusLine {
  kind: AppStatus;
  label: string;
  rateLabel: string | null;
  feeNote: string | null;
}

export interface DescribeStatusContext {
  online: boolean;
  pairRate: string | null;
  fromCode: string;
  toCode: string;
  feePercent: string;
  fetchError: string | null;
  refreshing?: boolean;
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
