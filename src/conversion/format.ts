import Big from "big.js";
import type { CurrencyDefinition } from "../types";

export function formatResult(
  value: string,
  currency: CurrencyDefinition,
): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  if (new Big(value).eq(0)) return "0";
  let maximumFractionDigits =
    currency.type === "crypto" ? 8 : Math.abs(number) < 0.01 ? 6 : 4;
  maximumFractionDigits = Math.max(maximumFractionDigits, currency.decimals);
  return new Intl.NumberFormat(undefined, {
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
