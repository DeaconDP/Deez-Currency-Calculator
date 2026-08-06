export type ParseResult =
  | { valid: true; normalized: string }
  | { valid: false; reason: string };

export function parseAmount(input: string): ParseResult {
  const value = input.trim();
  if (!value) return { valid: false, reason: "empty" };
  if (/[eE+-]/.test(value) || /(?:Infinity|NaN)/i.test(value))
    return { valid: false, reason: "Enter a positive decimal number." };
  const compact = value.replace(/\s/g, "");
  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  const decimalIndex = Math.max(lastDot, lastComma);
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = decimalIndex === lastDot ? "." : ",";
    normalized = compact
      .replace(decimal === "." ? /,/g : /\./g, "")
      .replace(decimal, ".");
  } else if (lastComma >= 0) {
    const parts = compact.split(",");
    normalized =
      parts.length > 2 || (parts[1]?.length === 3 && parts[0].length > 0)
        ? parts.join("")
        : compact.replace(",", ".");
  } else {
    const parts = compact.split(".");
    normalized = parts.length > 2 ? parts.join("") : compact;
  }
  if (!/^\d+(?:\.\d*)?$/.test(normalized))
    return { valid: false, reason: "Enter a positive decimal number." };
  const significant = normalized.replace(/^0+/, "").replace(".", "").length;
  if (significant > 18)
    return { valid: false, reason: "Use no more than 18 significant digits." };
  return {
    valid: true,
    normalized: normalized.endsWith(".") ? normalized.slice(0, -1) : normalized,
  };
}
