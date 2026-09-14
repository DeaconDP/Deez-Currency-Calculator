import { isFresh } from "../storage/storage";
import type { DescribeStatusContext, RateTable, StatusLine } from "../types";
import { formatRate } from "./format";

function feeNoteFor(feePercent: string): string | null {
  const fee = feePercent.trim();
  if (fee === "" || fee === "0") return null;
  if (!/^\d+(?:\.\d+)?$/.test(fee)) return null;
  const n = Number(fee);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return `Fee ${fee}%`;
}

function rateLabelFor(
  pairRate: string | null,
  fromCode: string,
  toCode: string,
): string | null {
  if (pairRate == null || pairRate === "") return null;
  return `1 ${fromCode} ≈ ${formatRate(pairRate)} ${toCode}`;
}

export function describeStatus(
  table: RateTable | null,
  now: number,
  ctx: DescribeStatusContext,
): StatusLine {
  const rateLabel = rateLabelFor(ctx.pairRate, ctx.fromCode, ctx.toCode);
  const feeNote = feeNoteFor(ctx.feePercent);

  if (!table && ctx.refreshing) {
    return { kind: "loading", label: "Loading", rateLabel: null, feeNote };
  }
  if (ctx.refreshing && table) {
    return { kind: "refreshing", label: "Refreshing", rateLabel, feeNote };
  }
  if (!ctx.online) {
    return { kind: "offline", label: "Offline", rateLabel, feeNote };
  }
  if (ctx.fetchError && !table) {
    return { kind: "error", label: "Error", rateLabel: null, feeNote };
  }
  if (!table) {
    return { kind: "loading", label: "Loading", rateLabel: null, feeNote };
  }
  if (isFresh(table.fetchedAt, now)) {
    return { kind: "fresh", label: "Fresh", rateLabel, feeNote };
  }
  return { kind: "stale", label: "Stale", rateLabel, feeNote };
}
