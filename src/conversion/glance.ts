import { getCurrency } from "../data/currencies";
import type { GlanceRow, RateTable } from "../types";
import { applyFee } from "./applyFee";
import { calculate } from "./calculate";
import { formatResult } from "./format";
import { parseAmount } from "./parseAmount";

const FAVORITE_CAP = 6;

export interface BuildGlanceRowsInput {
  baseAmount: string;
  favorites: string[];
  table: RateTable | null;
  feePercent: string;
  excludeCodes?: string[];
}

export function normalizeFavorites(codes: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of codes) {
    const code = entry.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= FAVORITE_CAP) break;
  }
  return out;
}

export function buildGlanceRows(input: BuildGlanceRowsInput): GlanceRow[] {
  const exclude = new Set(
    (input.excludeCodes ?? []).map((code) => code.trim()).filter(Boolean),
  );
  const codes = normalizeFavorites(input.favorites).filter(
    (code) => !exclude.has(code),
  );
  const parsed = parseAmount(input.baseAmount);
  if (!parsed.valid) {
    return codes.map((code) => ({
      code,
      ok: false,
      reason: "invalid-amount",
      display: null,
    }));
  }

  return codes.map((code) => {
    const currency = getCurrency(code);
    if (!currency) {
      return {
        code,
        ok: false,
        reason: "unknown-currency",
        display: null,
      };
    }
    const rate = input.table?.rates[code];
    if (!rate) {
      return {
        code,
        ok: false,
        reason: "unavailable",
        display: null,
      };
    }
    const raw = calculate(input.baseAmount, rate);
    if (raw == null) {
      return {
        code,
        ok: false,
        reason: "unavailable",
        display: null,
      };
    }
    return {
      code,
      ok: true,
      raw,
      display: formatResult(applyFee(raw, input.feePercent) ?? raw, currency),
    };
  });
}
