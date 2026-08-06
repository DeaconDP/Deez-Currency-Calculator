import Big from "big.js";
import { parseAmount } from "./parseAmount";

export function calculate(amount: string, rate: string): string | null {
  const parsed = parseAmount(amount);
  if (!parsed.valid || !isPositiveDecimal(rate)) return null;
  return new Big(parsed.normalized).times(rate).toFixed();
}

export function isPositiveDecimal(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) return false;
  try {
    return new Big(value).gt(0);
  } catch {
    return false;
  }
}
