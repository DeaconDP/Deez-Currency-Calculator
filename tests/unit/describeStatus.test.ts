import { describe, expect, it } from "vitest";
import { describeStatus } from "../../src/conversion/describeStatus";
import type { DescribeStatusContext, RateTable } from "../../src/types";

const table: RateTable = {
  base: "ZAR",
  rates: { USD: "0.055" },
  fetchedAt: 1_000_000,
  provider: "coinbase",
};

const baseCtx: DescribeStatusContext = {
  online: true,
  pairRate: "0.055",
  fromCode: "ZAR",
  toCode: "USD",
  feePercent: "",
  fetchError: null,
};

describe("describeStatus", () => {
  it("reports loading while refreshing without a table", () => {
    expect(
      describeStatus(null, 1_000_000, {
        ...baseCtx,
        refreshing: true,
        pairRate: null,
      }),
    ).toEqual({
      kind: "loading",
      label: "Loading",
      rateLabel: null,
      feeNote: null,
    });
  });

  it("reports refreshing when a table is already present", () => {
    expect(
      describeStatus(table, 1_000_050, {
        ...baseCtx,
        refreshing: true,
      }),
    ).toEqual({
      kind: "refreshing",
      label: "Refreshing",
      rateLabel: "1 ZAR ≈ 0.055 USD",
      feeNote: null,
    });
  });

  it("reports offline when the network is down", () => {
    expect(
      describeStatus(table, 1_000_050, {
        ...baseCtx,
        online: false,
      }),
    ).toEqual({
      kind: "offline",
      label: "Offline",
      rateLabel: "1 ZAR ≈ 0.055 USD",
      feeNote: null,
    });
  });

  it("reports error when fetch failed and there is no table", () => {
    expect(
      describeStatus(null, 1_000_000, {
        ...baseCtx,
        fetchError: "network",
        pairRate: null,
      }),
    ).toEqual({
      kind: "error",
      label: "Error",
      rateLabel: null,
      feeNote: null,
    });
  });

  it("reports fresh inside the 120s window", () => {
    expect(describeStatus(table, 1_000_000 + 60_000, baseCtx)).toEqual({
      kind: "fresh",
      label: "Fresh",
      rateLabel: "1 ZAR ≈ 0.055 USD",
      feeNote: null,
    });
  });

  it("reports stale after the 120s window", () => {
    expect(describeStatus(table, 1_000_000 + 120_000, baseCtx)).toEqual({
      kind: "stale",
      label: "Stale",
      rateLabel: "1 ZAR ≈ 0.055 USD",
      feeNote: null,
    });
  });

  it("reports loading when there is no table yet", () => {
    expect(
      describeStatus(null, 1_000_000, {
        ...baseCtx,
        pairRate: null,
      }),
    ).toEqual({
      kind: "loading",
      label: "Loading",
      rateLabel: null,
      feeNote: null,
    });
  });

  it("includes a fee note when fee percent is set", () => {
    expect(
      describeStatus(table, 1_000_050, {
        ...baseCtx,
        feePercent: "2.5",
      }),
    ).toEqual({
      kind: "fresh",
      label: "Fresh",
      rateLabel: "1 ZAR ≈ 0.055 USD",
      feeNote: "Fee 2.5%",
    });
  });
});
