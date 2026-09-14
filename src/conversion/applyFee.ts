import Big from "big.js";

function isDecimalString(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}

function parseFeePercent(feePercent: string): Big | null {
  const fee = feePercent.trim();
  if (fee === "" || fee === "0") return new Big(0);
  if (!isDecimalString(fee)) return null;
  try {
    const feeBig = new Big(fee);
    if (feeBig.lt(0) || feeBig.gt(100)) return null;
    return feeBig;
  } catch {
    return null;
  }
}

export function applyFee(raw: string, feePercent: string): string | null {
  if (typeof raw !== "string" || !isDecimalString(raw)) return null;
  const feeBig = parseFeePercent(feePercent);
  if (feeBig == null) return null;
  if (feeBig.eq(0)) return raw;
  try {
    return new Big(raw).times(new Big(1).minus(feeBig.div(100))).toFixed();
  } catch {
    return null;
  }
}

export function undoFee(net: string, feePercent: string): string | null {
  if (typeof net !== "string" || !isDecimalString(net)) return null;
  const feeBig = parseFeePercent(feePercent);
  if (feeBig == null) return null;
  if (feeBig.eq(0)) return net;
  if (feeBig.eq(100)) return null;
  try {
    return new Big(net).div(new Big(1).minus(feeBig.div(100))).toFixed();
  } catch {
    return null;
  }
}
