import Big from "big.js";
import type { CurrencyDefinition } from "../types";

export function formatResult(
  value: string,
  currency: CurrencyDefinition,
): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  if (new Big(value).eq(0)) return "0";
  const abs = Math.abs(number);
  // Crypto: up to 8 places. Fiat: the currency's own decimals (2 for ZAR, 0 for
  // JPY), with more precision only for sub-unit amounts so they never read "0.00".
  const maximumFractionDigits =
    currency.type === "crypto"
      ? Math.max(8, currency.decimals)
      : abs < 0.01
        ? 6
        : abs < 1
          ? Math.max(4, currency.decimals)
          : abs >= 1_000_000
            ? 0 // cents are noise at this size, and the number still fits
            : currency.decimals;
  // money reads as money: 69.80, not 69.8 (fiat from 1 up to a million)
  const minimumFractionDigits =
    currency.type === "fiat" && abs >= 1 && abs < 1_000_000 ? currency.decimals : 0;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping: true,
  }).format(number);
}

export function formatRate(value: string): string {
  const number = Number(value);
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(number) < 0.01 ? 8 : 4,
  }).format(number);
}
