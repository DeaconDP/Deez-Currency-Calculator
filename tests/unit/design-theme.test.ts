import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_THEME,
  DESIGN_PRESETS,
  THEME_KEY,
  applyTheme,
  getPresetTheme,
  loadDesignTheme,
  normalizeDesignTheme,
  saveDesignTheme,
  themeWithCustomFlag,
} from "../../src/theme/theme";
import type { DesignTheme } from "../../src/types";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage(),
    configurable: true,
  });
});

describe("design theme", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadDesignTheme()).toEqual(DEFAULT_DESIGN_THEME);
  });

  it("round-trips a full theme", () => {
    const theme: DesignTheme = {
      ...DESIGN_PRESETS.neon,
      presetId: "neon",
    };
    saveDesignTheme(theme);
    expect(loadDesignTheme()).toEqual(theme);
  });

  it("falls back to defaults on garbage JSON", () => {
    localStorage.setItem(THEME_KEY, "{not-json");
    expect(loadDesignTheme()).toEqual(DEFAULT_DESIGN_THEME);
  });

  it("clamps out-of-range numbers and drops bad colors", () => {
    const normalized = normalizeDesignTheme({
      background: "red",
      uiScale: 9,
      radius: -4,
      space: 0.1,
      controlHeight: 200,
      font: "comic",
      presetId: "nope",
    } as unknown as Partial<DesignTheme>);
    expect(normalized.background).toBe(DEFAULT_DESIGN_THEME.background);
    expect(normalized.uiScale).toBe(1.4);
    expect(normalized.radius).toBe(0);
    expect(normalized.space).toBe(0.6);
    expect(normalized.controlHeight).toBe(64);
    expect(normalized.font).toBe("pixel");
    expect(normalized.presetId).toBe("custom");
  });

  it("loads named presets", () => {
    expect(getPresetTheme("compact")).toEqual(DESIGN_PRESETS.compact);
    expect(getPresetTheme("high-contrast").controlText).toBe("#000000");
  });

  it("marks matching themes with their preset id", () => {
    expect(themeWithCustomFlag({ ...DESIGN_PRESETS.soft, presetId: "custom" }).presetId).toBe(
      "soft",
    );
    expect(
      themeWithCustomFlag({
        ...DEFAULT_DESIGN_THEME,
        money: "#112233",
        presetId: "default",
      }).presetId,
    ).toBe("custom");
  });

  it("applies CSS variables and font dataset", () => {
    const props: Record<string, string> = {};
    const root = {
      style: {
        setProperty(name: string, value: string) {
          props[name] = value;
        },
        getPropertyValue(name: string) {
          return props[name] ?? "";
        },
        colorScheme: "",
      },
      dataset: {} as DOMStringMap,
    } as unknown as HTMLElement;
    applyTheme(DESIGN_PRESETS.neon, root);
    expect(root.style.getPropertyValue("--money")).toBe("#00ff88");
    expect(root.style.getPropertyValue("--radius")).toBe("4px");
    expect(root.style.getPropertyValue("--ui-scale")).toBe("1");
    expect(root.dataset.font).toBe("pixel");
  });

  it("normalizes short hex failure to default and lowercases valid hex", () => {
    const normalized = normalizeDesignTheme({
      ...DEFAULT_DESIGN_THEME,
      money: "#FFD400",
      text: "#fff",
    });
    expect(normalized.money).toBe("#ffd400");
    expect(normalized.text).toBe(DEFAULT_DESIGN_THEME.text);
  });
});
