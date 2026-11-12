export type ParseResult =
  | { valid: true; normalized: string }
  | { valid: false; reason: string };

const INVALID: ParseResult = { valid: false, reason: "Enter a positive decimal number." };

const count = (s: string, ch: string) => s.split(ch).length - 1;

/** "1,234,567" with sep "," — first group 1–3 digits (not "0"), then groups of exactly 3. */
function isGrouped(s: string, sep: string): boolean {
  const parts = s.split(sep);
  return (
    parts.length > 1 &&
    /^\d{1,3}$/.test(parts[0]) &&
    parts[0] !== "0" &&
    parts.slice(1).every((p) => /^\d{3}$/.test(p))
  );
}

/**
 * Parse a typed amount into a plain decimal string ("1234.5").
 *
 * With `decimalSeparator` (the device locale's, e.g. "," in en-ZA / de-DE) the
 * locale decides: that character is always the decimal point, a second one is
 * an error, and the other character only counts as grouping when the digits are
 * grouped in threes. Without it, a lone "," followed by exactly three digits is
 * read as grouping and a lone "." is always the decimal point.
 */
export function parseAmount(input: string, decimalSeparator?: "." | ","): ParseResult {
  const value = input.trim();
  if (!value) return { valid: false, reason: "empty" };
  if (/[eE+-]/.test(value) || /(?:Infinity|NaN)/i.test(value)) return INVALID;
  // Spaces (and Swiss apostrophes) only ever group thousands: "1 250,50" yes,
  // "2 19.99" or "50 100" no — those are two numbers, not one.
  const chunks = value.split(/[\s\u00a0\u202f'’]+/);
  if (
    chunks.length > 1 &&
    !(
      /^\d{1,3}$/.test(chunks[0]) &&
      chunks.slice(1, -1).every((c) => /^\d{3}$/.test(c)) &&
      /^\d{3}(?:[.,]\d*)?$/.test(chunks[chunks.length - 1])
    )
  )
    return INVALID;
  let compact = chunks.join("");
  if (/^[.,]/.test(compact)) compact = `0${compact}`; // ".5" → "0.5"

  const dots = count(compact, ".");
  const commas = count(compact, ",");
  let normalized: string;

  if (dots && commas) {
    const decimal = compact.lastIndexOf(".") > compact.lastIndexOf(",") ? "." : ",";
    const group = decimal === "." ? "," : ".";
    if (count(compact, decimal) > 1) return INVALID;
    const [whole, frac] = compact.split(decimal);
    if (!isGrouped(whole, group)) return INVALID;
    normalized = `${whole.split(group).join("")}.${frac}`;
  } else if (dots || commas) {
    const sep = dots ? "." : ",";
    const n = dots || commas;
    if (decimalSeparator && sep === decimalSeparator) {
      if (n > 1) {
        // "1,234,567" on a comma-decimal phone can only be grouping; "1.5.5" is a typo
        if (!isGrouped(compact, sep)) return INVALID;
        normalized = compact.split(sep).join("");
      } else {
        normalized = compact.replace(sep, ".");
      }
    } else if (decimalSeparator) {
      if (isGrouped(compact, sep)) normalized = compact.split(sep).join("");
      else if (n === 1) normalized = compact.replace(sep, "."); // foreign decimal point
      else return INVALID;
    } else if (n === 1) {
      const [a, b] = compact.split(sep);
      normalized =
        sep === "," && b.length === 3 && a.length > 0 && a !== "0" ? a + b : `${a}.${b}`;
    } else if (isGrouped(compact, sep)) {
      normalized = compact.split(sep).join("");
    } else {
      return INVALID;
    }
  } else {
    normalized = compact;
  }

  if (!/^\d+(?:\.\d*)?$/.test(normalized)) return INVALID;
  const significant = normalized.replace(/^0+/, "").replace(".", "").length;
  if (significant > 18)
    return { valid: false, reason: "Use no more than 18 significant digits." };
  return {
    valid: true,
    normalized: normalized.endsWith(".") ? normalized.slice(0, -1) : normalized,
  };
}
