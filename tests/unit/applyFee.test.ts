import { describe, expect, it } from "vitest";
import { applyFee, undoFee } from "../../src/conversion/applyFee";

describe("applyFee", () => {
  it("returns raw when fee is empty", () => {
    expect(applyFee("100", "")).toBe("100");
  });

  it('returns raw when fee is "0"', () => {
    expect(applyFee("100", "0")).toBe("100");
  });

  it("returns raw when fee parses to zero", () => {
    expect(applyFee("100", "0.0")).toBe("100");
  });

  it("subtracts a percent from the mid-market amount", () => {
    expect(applyFee("100", "2.5")).toBe("97.5");
  });

  it("allows a 100 percent fee", () => {
    expect(applyFee("100", "100")).toBe("0");
  });

  it("returns null for fee above 100", () => {
    expect(applyFee("100", "100.1")).toBeNull();
  });

  it("returns null for invalid fee", () => {
    expect(applyFee("100", "abc")).toBeNull();
  });

  it("returns null for invalid raw", () => {
    expect(applyFee("nope", "2")).toBeNull();
  });

  it("returns null for negative fee", () => {
    expect(applyFee("100", "-1")).toBeNull();
  });
});

describe("undoFee", () => {
  it("round-trips with applyFee", () => {
    const net = applyFee("100", "2.5")!;
    expect(undoFee(net, "2.5")).toBe("100");
  });

  it("returns net when fee is empty", () => {
    expect(undoFee("97.5", "")).toBe("97.5");
  });

  it("returns null at 100 percent fee", () => {
    expect(undoFee("0", "100")).toBeNull();
  });
});
