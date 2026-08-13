import type { DesignFont, DesignPresetId, DesignTheme } from "../types";

const THEME_KEY = "deac-currency-design-v1";
const HEX = /^#[0-9a-fA-F]{6}$/;

const NAMED_PRESETS: Exclude<DesignPresetId, "custom">[] = [
  "default",
  "compact",
  "high-contrast",
  "soft",
  "neon",
];

export const DEFAULT_DESIGN_THEME: DesignTheme = {
  presetId: "default",
  background: "#000000",
  surface: "#111111",
  control: "#ffffff",
  controlText: "#757575",
  text: "#ffffff",
  muted: "#757575",
  money: "#ffd400",
  error: "#ff6b6b",
  focus: "#62b8ff",
  uiScale: 1,
  font: "pixel",
  radius: 10,
  space: 1,
  controlHeight: 48,
};

export const DESIGN_PRESETS: Record<
  Exclude<DesignPresetId, "custom">,
  DesignTheme
> = {
  default: { ...DEFAULT_DESIGN_THEME },
  compact: {
    ...DEFAULT_DESIGN_THEME,
    presetId: "compact",
    uiScale: 0.9,
    radius: 6,
    space: 0.75,
    controlHeight: 40,
  },
  "high-contrast": {
    ...DEFAULT_DESIGN_THEME,
    presetId: "high-contrast",
    background: "#000000",
    surface: "#000000",
    control: "#ffffff",
    controlText: "#000000",
    text: "#ffffff",
    muted: "#cccccc",
    money: "#ffff00",
    error: "#ff4444",
    focus: "#ffffff",
  },
  soft: {
    ...DEFAULT_DESIGN_THEME,
    presetId: "soft",
    background: "#1a1a1a",
    surface: "#252525",
    control: "#f0f0f0",
    controlText: "#666666",
    text: "#f5f5f5",
    muted: "#999999",
    money: "#e8c84a",
    error: "#e88a8a",
    focus: "#7eb8e0",
    radius: 16,
    space: 1.1,
    controlHeight: 52,
  },
  neon: {
    ...DEFAULT_DESIGN_THEME,
    presetId: "neon",
    background: "#050510",
    surface: "#0a0a1a",
    control: "#e8e8ff",
    controlText: "#3a3a6a",
    text: "#b8fff0",
    muted: "#6a8a9a",
    money: "#00ff88",
    error: "#ff2d6a",
    focus: "#ff00ff",
    radius: 4,
  },
};

function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function isFont(value: unknown): value is DesignFont {
  return value === "pixel" || value === "system";
}

function isPresetId(value: unknown): value is DesignPresetId {
  return (
    value === "custom" ||
    (typeof value === "string" &&
      (NAMED_PRESETS as string[]).includes(value))
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

export function normalizeDesignTheme(
  value: Partial<DesignTheme> | null | undefined,
): DesignTheme {
  const base = DEFAULT_DESIGN_THEME;
  if (!value || typeof value !== "object") return { ...base };

  return {
    presetId: isPresetId(value.presetId) ? value.presetId : "custom",
    background: isHex(value.background) ? value.background.toLowerCase() : base.background,
    surface: isHex(value.surface) ? value.surface.toLowerCase() : base.surface,
    control: isHex(value.control) ? value.control.toLowerCase() : base.control,
    controlText: isHex(value.controlText)
      ? value.controlText.toLowerCase()
      : base.controlText,
    text: isHex(value.text) ? value.text.toLowerCase() : base.text,
    muted: isHex(value.muted) ? value.muted.toLowerCase() : base.muted,
    money: isHex(value.money) ? value.money.toLowerCase() : base.money,
    error: isHex(value.error) ? value.error.toLowerCase() : base.error,
    focus: isHex(value.focus) ? value.focus.toLowerCase() : base.focus,
    uiScale: num(value.uiScale, base.uiScale, 0.75, 1.4),
    font: isFont(value.font) ? value.font : base.font,
    radius: num(value.radius, base.radius, 0, 24),
    space: num(value.space, base.space, 0.6, 1.4),
    controlHeight: num(value.controlHeight, base.controlHeight, 40, 64),
  };
}

export function getPresetTheme(
  id: Exclude<DesignPresetId, "custom">,
): DesignTheme {
  return { ...DESIGN_PRESETS[id] };
}

export function themeWithCustomFlag(theme: DesignTheme): DesignTheme {
  const { presetId: _ignored, ...rest } = theme;
  for (const id of NAMED_PRESETS) {
    const preset = DESIGN_PRESETS[id];
    const match = (Object.keys(rest) as (keyof typeof rest)[]).every(
      (key) => rest[key] === preset[key],
    );
    if (match) return { ...theme, presetId: id };
  }
  return { ...theme, presetId: "custom" };
}

export function loadDesignTheme(): DesignTheme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return { ...DEFAULT_DESIGN_THEME };
    return normalizeDesignTheme(JSON.parse(raw) as Partial<DesignTheme>);
  } catch {
    return { ...DEFAULT_DESIGN_THEME };
  }
}

export function saveDesignTheme(theme: DesignTheme) {
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(normalizeDesignTheme(theme)));
  } catch {
    /* unavailable storage is non-fatal */
  }
}

export function applyTheme(
  theme: DesignTheme,
  root: HTMLElement = document.documentElement,
) {
  const t = normalizeDesignTheme(theme);
  const style = root.style;
  style.setProperty("--background", t.background);
  style.setProperty("--surface", t.surface);
  style.setProperty("--control", t.control);
  style.setProperty("--control-text", t.controlText);
  style.setProperty("--text", t.text);
  style.setProperty("--muted", t.muted);
  style.setProperty("--money", t.money);
  style.setProperty("--error", t.error);
  style.setProperty("--focus", t.focus);
  style.setProperty("--ui-scale", String(t.uiScale));
  style.setProperty("--radius", `${t.radius}px`);
  style.setProperty("--space", String(t.space));
  style.setProperty("--control-height", `${t.controlHeight}px`);
  root.dataset.font = t.font;
  root.style.colorScheme =
    luminance(t.background) > 0.45 ? "light" : "dark";
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export { THEME_KEY, NAMED_PRESETS };
