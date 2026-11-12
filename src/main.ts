import "./styles.css";
import { registerSW } from "virtual:pwa-register";
import { CoinbaseProvider } from "./api/coinbase";
import { calculate, calculateInverse } from "./conversion/calculate";
import { describeStatus } from "./conversion/describeStatus";
import { formatRate, formatResult } from "./conversion/format";
import { parseAmount } from "./conversion/parseAmount";
import { tipDestinations } from "./config/tips";
import { currencies, getCurrency } from "./data/currencies";
import {
  clearRateCache,
  getCachedRates,
  isFresh,
  loadPreferences,
  savePreferences,
  setCachedRates,
} from "./storage/storage";
import {
  LOOK_PRESETS,
  applyTheme,
  getPresetTheme,
  loadDesignTheme,
  saveDesignTheme,
  themeWithCustomFlag,
} from "./theme/theme";
import type { AppStatus, DesignTheme, RateTable } from "./types";

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
  }
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

const isTauri = Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
// App Store / Play reject non-IAP donations (ASC 3.1.1). Keep tips on web + desktop only.
const tauriPlatform = String(import.meta.env.TAURI_ENV_PLATFORM ?? "")
  .trim()
  .toLowerCase();
const forceNoTips = new URLSearchParams(location.search).has("forceNoTips");
const tipsAllowed =
  !forceNoTips && tauriPlatform !== "ios" && tauriPlatform !== "android";

const provider = new CoinbaseProvider();
const prefs = loadPreferences();
let designTheme = loadDesignTheme();
applyTheme(designTheme);
let table: RateTable | null = null;
let status: AppStatus = "loading";
let lastError = "None";
let lastFetchFailed = false;
let requestDuration: number | null = null;
let abortController: AbortController | null = null;
let deferredInstall: BeforeInstallPromptEvent | null = null;
let source: "top" | "bottom" = prefs.source;
const logs: string[] = [];

const app = document.querySelector<HTMLDivElement>("#app")!;
let fromCode = prefs.from;
let toCode = prefs.to;
let currencyPickerTarget: "from" | "to" | null = null;

/* ---------- locale numbers ---------- */

const numberParts = new Intl.NumberFormat().formatToParts(1234.5);
const decimalSeparator = (numberParts.find((p) => p.type === "decimal")?.value === "," ? "," : ".") as
  | "."
  | ",";
/** Parse with the device locale's decimal point (the keypad shows the same one). */
const parse = (value: string) => parseAmount(value, decimalSeparator);

/* ---------- pixel icons (drawn on a grid, rendered with crisp edges) ---------- */

function pixelIcon(
  grid: number,
  size: number,
  rects: [number, number, number, number][],
  cls: string,
) {
  const body = rects
    .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`)
    .join("");
  return `<svg class="px-icon ${cls}" viewBox="0 0 ${grid} ${grid}" width="${size}" height="${size}" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">${body}</svg>`;
}

const gearIcon = pixelIcon(
  16,
  32,
  [
    // teeth
    [7, 1, 2, 2], [7, 13, 2, 2], [1, 7, 2, 2], [13, 7, 2, 2],
    [3, 3, 2, 2], [11, 3, 2, 2], [3, 11, 2, 2], [11, 11, 2, 2],
    // ring with a hollow hub
    [5, 3, 6, 1], [4, 4, 8, 1], [3, 5, 3, 1], [10, 5, 3, 1],
    [3, 6, 2, 4], [11, 6, 2, 4], [3, 10, 3, 1], [10, 10, 3, 1],
    [4, 11, 8, 1], [5, 12, 6, 1],
  ],
  "icon-gear",
);
const heartIcon = pixelIcon(
  8,
  32,
  [
    [1, 1, 2, 1], [5, 1, 2, 1], [0, 2, 8, 2], [1, 4, 6, 1], [2, 5, 4, 1], [3, 6, 2, 1],
  ],
  "icon-heart",
);
const flipIcon = pixelIcon(
  16,
  32,
  [
    // up arrow (left)
    [4, 2, 2, 1], [3, 3, 4, 1], [2, 4, 6, 1], [4, 5, 2, 9],
    // down arrow (right)
    [10, 2, 2, 9], [8, 11, 6, 1], [9, 12, 4, 1], [10, 13, 2, 1],
  ],
  "icon-flip",
);
const chevronIcon = pixelIcon(
  8,
  16,
  [[1, 2, 6, 1], [2, 3, 4, 1], [3, 4, 2, 1]],
  "icon-chevron",
);
const closeIcon = pixelIcon(
  8,
  16,
  [
    [1, 1, 2, 1], [5, 1, 2, 1], [2, 2, 2, 1], [4, 2, 2, 1], [3, 3, 2, 2],
    [2, 5, 2, 1], [4, 5, 2, 1], [1, 6, 2, 1], [5, 6, 2, 1],
  ],
  "icon-close",
);
const checkIcon = pixelIcon(
  8,
  16,
  [[6, 1, 2, 1], [5, 2, 2, 1], [0, 3, 2, 1], [4, 3, 2, 1], [1, 4, 4, 1], [2, 5, 2, 1]],
  "icon-check",
);
const refreshIcon = pixelIcon(
  8,
  16,
  [
    [2, 1, 3, 1], [5, 0, 1, 1], [5, 1, 2, 1], [5, 2, 1, 1],
    [1, 2, 1, 1], [0, 3, 1, 2], [1, 5, 1, 1], [2, 6, 4, 1], [6, 5, 1, 1], [7, 3, 1, 2],
  ],
  "icon-refresh",
);

/** Extra words people search by: symbols, countries, nicknames. */
const SEARCH_ALIASES: Record<string, string> = {
  ZAR: "r rand south africa sa",
  USD: "$ dollar america united states us usa greenback",
  EUR: "€ europe eurozone",
  GBP: "£ pound sterling uk britain england",
  AUD: "a$ australia aussie",
  CAD: "c$ canada loonie",
  CHF: "switzerland swiss",
  CNY: "¥ china renminbi rmb yuan",
  JPY: "¥ japan yen",
  INR: "₹ india rupee",
  NZD: "nz$ new zealand kiwi",
  BRL: "r$ brazil",
  BWP: "p botswana",
  KES: "ksh kenya",
  NGN: "₦ nigeria",
  AED: "uae emirates dubai dirham",
  BTC: "₿ bitcoin xbt sats",
  ETH: "ether ethereum",
  USDC: "stablecoin circle",
  USDT: "stablecoin tether",
};
const rightIcon = pixelIcon(16, 16, [[5, 3, 2, 10], [7, 5, 2, 6], [9, 7, 2, 2]], "icon-right");

/* ---------- markup ---------- */

const upper = (s: string) => s.toUpperCase();

const currencyPickerListMarkup = (["fiat", "crypto"] as const)
  .map((type) => {
    const label = type === "fiat" ? "Fiat" : "Crypto";
    const rows = currencies
      .filter((c) => c.type === type)
      .map(
        (c) =>
          `<button type="button" class="currency-option" data-code="${c.code}" data-search="${c.code.toLowerCase()} ${c.name.toLowerCase()} ${SEARCH_ALIASES[c.code] ?? ""}" aria-label="${c.code} ${c.name}">
            <span class="opt-code">${c.code}</span>
            <span class="opt-name">${upper(c.name)}</span>
            <span class="opt-tag" aria-hidden="true">SWAP</span>
            ${checkIcon}
          </button>`,
      )
      .join("");
    return `<section class="currency-group" aria-label="${label} currencies">
      <h3 class="group-label">${upper(label)}</h3>
      <div class="currency-option-list">${rows}</div>
    </section>`;
  })
  .join("");

const tipCards = tipDestinations
  .map(
    (tip) =>
      `<figure class="tip-card"><img src="${tip.qrAssetPath}" alt="${tip.asset} donation QR code" width="394" height="394"><figcaption>${tip.label}</figcaption></figure>`,
  )
  .join("");

const lookMarkup = LOOK_PRESETS.map(({ id, label }) => {
  const t = getPresetTheme(id);
  return `<button type="button" class="look" role="radio" data-preset="${id}" aria-checked="${designTheme.presetId === id}" aria-label="${label} look">
      <span class="look-swatch" aria-hidden="true">
        <i style="background:${t.background}"></i><i style="background:${t.control}"></i><i style="background:${t.money}"></i>
      </span>
      <span class="look-name">${label}</span>
    </button>`;
}).join("");

const leg = (
  which: "top" | "bottom",
  inputId: "amount" | "result",
  triggerId: "from-trigger" | "to-trigger",
  code: string,
  value: string,
) => `
  <div class="leg" data-leg="${which}">
    <div class="leg-head">
      <span class="leg-label" aria-hidden="true"><span class="leg-role" id="${inputId}-role"></span><span class="leg-name" id="${inputId}-name"></span></span>
      <span class="leg-aside">
        <span id="${inputId}-error" class="field-error"></span>
        <button id="${inputId}-copy" class="copy-btn" type="button" hidden>COPY</button>
      </span>
    </div>
    <div class="leg-row">
      <div class="well">
        <input id="${inputId}" inputmode="decimal" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" maxlength="28" placeholder="--" value="${value}" aria-describedby="${inputId}-error">
      </div>
      <button id="${triggerId}" class="currency-trigger" type="button" aria-haspopup="dialog" aria-controls="currency-picker">
        <span class="currency-trigger-code">${code}</span>
        ${chevronIcon}
      </button>
    </div>
  </div>`;

const sheetHead = (titleId: string, title: string, closeLabel: string) => `
  <div class="sheet-head">
    <h2 id="${titleId}" class="sheet-title">${title}</h2>
    <button class="close" type="button" aria-label="${closeLabel}">${closeIcon}</button>
  </div>`;

app.innerHTML = `
  <main class="shell">
    ${
      forceNoTips
        ? `<p class="store-shell-banner" role="status">Store shell preview — tip donations hidden (App Store 3.1.1)</p>`
        : ""
    }
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark-wrap" aria-hidden="true"><span class="brand-mark"></span></span>
        <h1 class="wordmark" aria-label="Deez Currency Calculator"><span class="wordmark-main">DEEZ</span><span class="wordmark-sub">CURRENCY CALC</span></h1>
      </div>
      <div class="topbar-actions">
        ${tipsAllowed ? `<button id="tip-open" class="icon-btn" type="button" aria-label="Tip jar" aria-haspopup="dialog">${heartIcon}</button>` : ""}
        <button id="design-open" class="icon-btn" type="button" aria-label="Settings" aria-haspopup="dialog" aria-controls="design-dialog">${gearIcon}</button>
      </div>
    </header>
    <section class="converter" aria-labelledby="converter-title">
      <h2 id="converter-title" class="sr-only">Currency calculator</h2>
      <div class="panel">
        ${leg("top", "amount", "from-trigger", prefs.from, prefs.amount)}
        <div class="divider">
          <button id="swap" class="swap" type="button" aria-label="Flip direction" title="Flip direction: type the other amount">${flipIcon}</button>
        </div>
        ${leg("bottom", "result", "to-trigger", prefs.to, prefs.result)}
      </div>
      <button id="rate-status" class="status" type="button" data-kind="loading">
        <span class="status-top">
          <span class="status-dot" aria-hidden="true"></span>
          <span id="status-label" class="status-label">LOADING</span>
          <span id="status-when" class="status-when"></span>
          <span class="status-refresh" aria-hidden="true">${refreshIcon}</span>
        </span>
        <span id="status-rate" class="status-rate"></span>
        <span id="status-inverse" class="status-rate status-inverse"></span>
        <span id="status-hint" class="status-hint"></span>
      </button>
      <p id="main-error" class="sr-only" role="alert"></p>
      <p id="announce" class="sr-only" role="status" aria-live="polite"></p>
    </section>
    <footer class="foot"><span>MID-MARKET RATES</span> · <span>NO FEES ADDED</span> · <span>DATA: COINBASE</span></footer>
  </main>
  ${
    tipsAllowed
      ? `<dialog id="tip-dialog" class="sheet tip-dialog" aria-labelledby="tip-title">
    ${sheetHead("tip-title-bar", "TIP JAR", "Close tip screen")}
    <div class="sheet-body tip-body">
      <h2 id="tip-title" class="tip-title"><span>TIP IF</span> <span>YOU'RE</span> <span>COOL</span></h2>
      <div class="tip-qr-well">${tipCards}</div>
    </div>
  </dialog>`
      : ""
  }
  <dialog id="currency-picker" class="sheet currency-picker" aria-labelledby="currency-picker-title">
    ${sheetHead("currency-picker-title", "FROM CURRENCY", "Close currency list")}
    <div class="sheet-search">
      <div class="well search-well">
        <input id="currency-search" type="search" placeholder="SEARCH" aria-label="Search currencies" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" enterkeyhint="search">
      </div>
    </div>
    <section id="currency-recents" class="currency-recents" aria-labelledby="recents-label" hidden>
      <h3 id="recents-label" class="group-label">RECENT</h3>
      <div id="currency-recents-row" class="recents-row"></div>
    </section>
    <div id="currency-picker-list" class="sheet-body currency-picker-list">
      ${currencyPickerListMarkup}
      <p id="currency-empty" class="empty" hidden>NO MATCH</p>
    </div>
  </dialog>
  <dialog id="design-dialog" class="sheet design-dialog" aria-labelledby="design-title">
    ${sheetHead("design-title", "SETTINGS", "Close settings")}
    <div class="sheet-body">
      <section class="group" aria-labelledby="look-label">
        <h3 id="look-label" class="group-label">LOOK</h3>
        <div class="looks" role="radiogroup" aria-labelledby="look-label">${lookMarkup}</div>
      </section>
      <section class="group" aria-labelledby="text-label">
        <h3 id="text-label" class="group-label">TEXT</h3>
        <div class="list">
          <button id="large-text" class="list-row" type="button" role="switch" aria-checked="false">
            <span class="row-title">LARGE TEXT</span><span class="switch" aria-hidden="true"><span class="switch-knob"></span></span>
          </button>
        </div>
      </section>
      <section class="group" aria-labelledby="rates-label">
        <h3 id="rates-label" class="group-label">RATES</h3>
        <div class="list">
          <button id="settings-refresh" class="list-row" type="button">
            <span class="row-title">REFRESH NOW</span><span id="settings-updated" class="row-value"></span>
          </button>
          <div class="list-row is-static"><span class="row-title">SOURCE</span><span class="row-value">COINBASE</span></div>
        </div>
      </section>
      <section class="group" aria-labelledby="about-label">
        <h3 id="about-label" class="group-label">ABOUT</h3>
        <div class="list">
          <div class="list-row is-static"><span class="row-title">VERSION</span><span class="row-value">${__APP_VERSION__}</span></div>
          <button id="debug-open" class="list-row" type="button" aria-haspopup="dialog" aria-controls="debug-panel">
            <span class="row-title">DIAGNOSTICS</span>${rightIcon}
          </button>
        </div>
      </section>
    </div>
  </dialog>
  <dialog id="debug-panel" class="sheet debug-panel" aria-labelledby="debug-title">
    ${sheetHead("debug-title", "DIAGNOSTICS", "Close diagnostics")}
    <div class="sheet-body">
      <div id="debug-content" class="debug-meta"></div>
      <h3 class="group-label">SESSION LOG</h3>
      <pre id="session-log" tabindex="0"></pre>
      <div class="debug-actions">
        <button id="debug-refresh" class="btn" type="button">REFRESH RATES</button>
        <button id="clear-cache" class="btn" type="button">CLEAR CACHE</button>
        <button id="copy-diagnostics" class="btn" type="button">COPY REPORT</button>
        <button id="install-app" class="btn" type="button" hidden>INSTALL APP</button>
      </div>
    </div>
  </dialog>
  <aside id="update-toast" hidden>NEW VERSION READY <button id="update-app" class="btn" type="button">UPDATE</button></aside>`;

/* ---------- elements ---------- */

function byId<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}

const amount = byId<HTMLInputElement>("amount");
const result = byId<HTMLInputElement>("result");
const fromTrigger = byId<HTMLButtonElement>("from-trigger");
const toTrigger = byId<HTMLButtonElement>("to-trigger");
const swapButton = byId<HTMLButtonElement>("swap");
const statusButton = byId<HTMLButtonElement>("rate-status");
const currencyPicker = byId<HTMLDialogElement>("currency-picker");
const currencyPickerTitle = byId("currency-picker-title");
const currencySearch = byId<HTMLInputElement>("currency-search");
const debugPanel = byId<HTMLDialogElement>("debug-panel");
const tipDialog = tipsAllowed ? byId<HTMLDialogElement>("tip-dialog") : null;
const designDialog = byId<HTMLDialogElement>("design-dialog");
const designOpen = byId<HTMLButtonElement>("design-open");

/**
 * Select all on focus so a tap is ready to replace. The native highlight
 * renders muddy over the pixel digits, so the well itself inverts instead
 * (.is-replacing) until you type, tap again to place the caret, or leave.
 */
function selectAllOnFocus(input: HTMLInputElement) {
  const well = input.closest(".well")!;
  let focusing = false;
  const markReplacing = () => {
    input.select();
    well.classList.toggle("is-replacing", Boolean(input.value));
  };
  let typed = false;
  input.addEventListener("focus", () => {
    focusing = true;
    window.setTimeout(() => (focusing = false), 500); // keyboard focus: no click follows
    typed = false;
    markReplacing();
    // WebKit can drop a selection made during focus; redo it next frame,
    // unless typing already started (it would swallow the first keystroke)
    requestAnimationFrame(() => {
      if (!typed && document.activeElement === input) markReplacing();
    });
  });
  const stop = () => well.classList.remove("is-replacing");
  input.addEventListener("input", () => {
    typed = true;
    stop();
  });
  input.addEventListener("blur", stop);
  input.addEventListener("click", () => {
    if (focusing) focusing = false; // the tap that focused it
    else stop(); // a second tap places the caret
  });
  // Desktop browsers clear selection on mouseup after focus; keep it.
  input.addEventListener("mouseup", (event) => event.preventDefault());
}
selectAllOnFocus(amount);
selectAllOnFocus(result);

function log(message: string) {
  logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  if (logs.length > 100) logs.shift();
  renderDebug();
}

function save() {
  savePreferences({
    amount: amount.value,
    result: result.value,
    from: fromCode,
    to: toCode,
    source,
    favorites: [],
    feePercent: "",
  });
}

/* ---------- converter ---------- */

function syncCurrencyTriggers() {
  const fromCurrency = getCurrency(fromCode);
  const toCurrency = getCurrency(toCode);
  fromTrigger.querySelector(".currency-trigger-code")!.textContent = fromCode;
  toTrigger.querySelector(".currency-trigger-code")!.textContent = toCode;
  byId("amount-name").textContent = upper(fromCurrency?.name ?? fromCode);
  byId("result-name").textContent = upper(toCurrency?.name ?? toCode);
  fromTrigger.setAttribute(
    "aria-label",
    `Top currency: ${fromCode}${fromCurrency ? ` ${fromCurrency.name}` : ""}. Change`,
  );
  toTrigger.setAttribute(
    "aria-label",
    `Bottom currency: ${toCode}${toCurrency ? ` ${toCurrency.name}` : ""}. Change`,
  );
  paintFields();
}

const nameOf = (code: string) => getCurrency(code)?.name ?? code;

/** Fit the amount to its well: Press Start 2P is monospace, so 1 char = 1 em. */
function fitInput(input: HTMLInputElement) {
  const chars = Math.max(input.value.length, 1);
  const width = input.clientWidth - 2;
  if (width <= 0) return;
  // While editing, never below 16px (readable, and iOS zooms inputs under 16px
  // on focus). At rest a very long amount may drop to 8px rather than be cut off.
  const editing = document.activeElement === input;
  const size = chars * 24 <= width ? 24 : chars * 16 <= width || editing ? 16 : 8;
  input.dataset.size = String(size);
}

/**
 * Roles follow the direction: the field you type in says YOU TYPE, the computed
 * one says ≈ YOU GET in the accent colour. Labels stay true after a flip.
 */
function paintFields() {
  const legs = {
    top: app.querySelector<HTMLElement>('[data-leg="top"]')!,
    bottom: app.querySelector<HTMLElement>('[data-leg="bottom"]')!,
  };
  const drivenSide = source === "top" ? "bottom" : "top";
  legs[source].classList.remove("is-driven");
  legs[drivenSide].classList.add("is-driven");
  byId(source === "top" ? "amount-role" : "result-role").textContent = "YOU TYPE";
  byId(source === "top" ? "result-role" : "amount-role").textContent = "≈ YOU GET";
  const typedCode = source === "top" ? fromCode : toCode;
  const drivenCode = source === "top" ? toCode : fromCode;
  const sourceInput = source === "top" ? amount : result;
  const drivenInput = source === "top" ? result : amount;
  sourceInput.setAttribute("aria-label", `You type, in ${nameOf(typedCode)}`);
  drivenInput.setAttribute(
    "aria-label",
    `You get, in ${nameOf(drivenCode)}. Edit to convert the other way`,
  );
  swapButton.setAttribute("aria-label", `Flip: type in ${nameOf(drivenCode)} instead`);
  swapButton.title = `Type in ${drivenCode} instead`;
  byId(source === "top" ? "amount-copy" : "result-copy").hidden = true;
  byId(source === "top" ? "result-copy" : "amount-copy").hidden = !drivenInput.value;
  byId(source === "top" ? "result-copy" : "amount-copy").setAttribute(
    "aria-label",
    `Copy ${drivenInput.value} ${nameOf(drivenCode)}`,
  );
  fitInput(amount);
  fitInput(result);
}

let announceTimer = 0;
/** Speak to VoiceOver; clearing first makes repeats (e.g. copying twice) speak again. */
function say(text: string) {
  const node = byId("announce");
  node.textContent = "";
  window.setTimeout(() => (node.textContent = text), 50);
}
/** Spoken summary — only after the user acts (typing, flipping, picking). Typed side first. */
function announce(prefix = "") {
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    const parts: string[] = [];
    if (prefix) parts.push(prefix);
    const [typed, typedCode, got, gotCode] =
      source === "top"
        ? [amount.value, fromCode, result.value, toCode]
        : [result.value, toCode, amount.value, fromCode];
    if (typed && got) parts.push(`${typed} ${nameOf(typedCode)} is ${got} ${nameOf(gotCode)}`);
    if (parts.length) say(parts.join(". "));
  }, prefix ? 150 : 700);
}

function renderConversion() {
  const rate = table?.rates[toCode];
  const fromCurrency = getCurrency(fromCode);
  const toCurrency = getCurrency(toCode);
  const sourceInput = source === "top" ? amount : result;
  const drivenInput = source === "top" ? result : amount;
  const sourceError = byId(source === "top" ? "amount-error" : "result-error");
  const drivenError = byId(source === "top" ? "result-error" : "amount-error");
  const drivenCurrency = source === "top" ? toCurrency : fromCurrency;
  const parsed = parse(sourceInput.value);
  const invalid = Boolean(sourceInput.value && !parsed.valid);

  const previousError = sourceError.textContent;
  drivenError.textContent = "";
  sourceError.textContent = clipped
    ? "MAX LENGTH"
    : !parsed.valid && invalid
      ? shortReason(parsed.reason)
      : "";
  // VoiceOver doesn't re-read aria-describedby, so speak a new error once
  if (sourceError.textContent && sourceError.textContent !== previousError)
    say(sourceError.textContent === "MAX LENGTH" ? "Maximum length reached" : "Numbers only");
  sourceInput.closest(".well")!.classList.toggle("is-invalid", invalid);
  sourceInput.closest(".well")!.classList.toggle("is-limit", clipped);
  sourceError.classList.toggle("is-notice", clipped);
  drivenError.classList.remove("is-notice");
  drivenInput.closest(".well")!.classList.remove("is-invalid");

  if (sourceInput.value && parsed.valid && rate && drivenCurrency) {
    const mid =
      source === "top"
        ? calculate(parsed.normalized, rate)!
        : calculateInverse(parsed.normalized, rate)!;
    drivenInput.value = formatResult(mid, drivenCurrency);
  } else {
    // empty, invalid or no rate: never leave a stale number standing
    drivenInput.value = "";
    if (sourceInput.value && parsed.valid && !rate && status !== "loading" && status !== "refreshing")
      drivenError.textContent = "NO RATE";
  }

  paintFields();
  renderStatus();
  save();
}

function shortReason(reason: string) {
  if (/18 significant/.test(reason)) return "MAX LENGTH";
  return "NUMBERS ONLY";
}

/** Where the decimal point is, using the same rules as parseAmount (-1 if none). */
function decimalIndex(raw: string): number {
  const dot = raw.lastIndexOf(".");
  const comma = raw.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) return Math.max(dot, comma); // "1.250,50" / "1,250.50"
  const sep = dot >= 0 ? "." : comma >= 0 ? "," : null;
  if (!sep) return -1;
  if (sep === decimalSeparator) return raw.lastIndexOf(sep);
  const parts = raw.replace(/[\s\u00a0\u202f'’]/g, "").split(sep);
  const grouped =
    /^\d{1,3}$/.test(parts[0]) && parts[0] !== "0" && parts.slice(1).every((p) => /^\d{3}$/.test(p));
  if (grouped) return -1;
  return parts.length === 2 ? raw.lastIndexOf(sep) : -1;
}

let clipped = false;
/**
 * Keep only characters that can be part of a number and cap it at 12 whole
 * digits / 18 in all. It never moves or rewrites separators, so a pasted
 * "$1,250.50" or "€1.250,50" reaches the parser intact in any locale.
 */
function sanitize(input: HTMLInputElement) {
  const raw = input.value.replace(/[^\d.,\s\u00a0\u202f'’]/g, "").replace(/^\s+/, "");
  const cut = decimalIndex(raw);
  let whole = 0;
  let total = 0;
  let out = "";
  [...raw].forEach((ch, i) => {
    if (!/\d/.test(ch)) {
      out += ch;
      return;
    }
    const isWhole = cut < 0 || i < cut;
    if (total >= 18 || (isWhole && whole >= 12)) {
      clipped = true;
      return;
    }
    if (isWhole) whole += 1;
    total += 1;
    out += ch;
  });
  if (out !== input.value) input.value = out;
}

/** Show a parsed amount the locale's way: grouped, with its decimal point. */
function formatTyped(normalized: string) {
  const [int, frac] = normalized.split(".");
  const grouped = new Intl.NumberFormat(undefined, { useGrouping: true }).format(BigInt(int));
  return frac ? `${grouped}${decimalSeparator}${frac}` : grouped;
}
// Typed amounts are reformatted on blur with the same locale rules as the
// computed side (1250.5 → 1,250.5 / 1 250,5 / 1.250,5) and shown plain while
// editing (1250.5 / 1250,5). Both go through the locale-aware parser, so the
// round trip never changes the number.
function groupOnBlur(input: HTMLInputElement) {
  const parsed = parse(input.value);
  if (!parsed.valid) return;
  input.value = formatTyped(parsed.normalized);
  fitInput(input);
}
function ungroupOnFocus(input: HTMLInputElement) {
  const parsed = parse(input.value);
  if (!parsed.valid) return;
  const plain = parsed.normalized.replace(".", decimalSeparator);
  if (plain !== input.value) {
    input.value = plain;
    input.select(); // rewriting the value drops the tap-to-replace selection
  }
  fitInput(input);
}

/** What COPY puts on the clipboard: the value as shown, digits plus the decimal point. */
function copyValue(display: string) {
  return display
    .split(decimalSeparator)
    .map((part) => part.replace(/\D/g, ""))
    .join(decimalSeparator);
}

/* ---------- status line ---------- */

function whenLabel(ts: number) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay
    ? time
    : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

function renderStatus() {
  const pairRate = table?.rates[toCode] ?? null;
  const refreshing = status === "loading" || status === "refreshing";
  const line = describeStatus(table, Date.now(), {
    online: navigator.onLine,
    pairRate,
    fromCode,
    toCode,
    feePercent: "",
    fetchError: status === "error" ? lastError : null,
    refreshing,
  });
  let kind: string = line.kind;
  let label = "";
  let hint = "";
  const when = table ? whenLabel(table.fetchedAt) : "";
  if (table && !pairRate && !refreshing) kind = "error";
  switch (kind) {
    case "loading":
      label = "LOADING";
      hint = "FETCHING RATES";
      break;
    case "refreshing":
      label = "UPDATING";
      hint = "FETCHING LATEST RATES";
      break;
    case "fresh":
      label = "LIVE";
      hint = lastFetchFailed ? "COULDN'T UPDATE · TAP TO RETRY" : "";
      break;
    case "stale":
      label = "CACHED";
      hint = lastFetchFailed ? "COULDN'T UPDATE · TAP TO RETRY" : "TAP TO UPDATE";
      break;
    case "offline":
      label = "OFFLINE";
      hint = table ? "SHOWING SAVED RATES · TAP TO RETRY" : "NO SAVED RATES · TAP TO RETRY";
      break;
    default:
      label = "NO RATES";
      hint =
        table && !pairRate
          ? `NO RATE FOR ${fromCode} → ${toCode} · TAP TO RETRY`
          : "CAN'T REACH COINBASE · TAP TO RETRY";
  }
  statusButton.dataset.kind = kind;
  byId("status-label").textContent = label;
  byId("status-when").textContent = when && kind !== "error" ? when : "";
  byId("status-rate").textContent =
    pairRate && kind !== "error" ? `1 ${fromCode} = ${formatRate(pairRate)} ${toCode}` : "";
  const inverse = pairRate ? calculateInverse("1", pairRate) : null;
  byId("status-inverse").textContent =
    inverse && kind !== "error" ? `1 ${toCode} = ${formatRate(inverse)} ${fromCode}` : "";
  byId("status-hint").textContent = hint;
  statusButton.setAttribute(
    "aria-label",
    [
      label,
      byId("status-rate").textContent,
      byId("status-inverse").textContent,
      when ? `updated ${when}` : "",
      hint || "Refresh rates",
    ]
      .filter(Boolean)
      .join(". "),
  );
  statusButton.setAttribute("aria-busy", String(refreshing));
  const alertText = kind === "error" ? hint.replace(" · TAP TO RETRY", "") : "";
  if (byId("main-error").textContent !== alertText) byId("main-error").textContent = alertText;
  byId("settings-updated").textContent = when;
}

/* ---------- rates ---------- */

async function loadRates(force = false) {
  abortController?.abort();
  const own = new AbortController();
  abortController = own;
  status = table ? "refreshing" : "loading";
  renderStatus();
  const cached = await getCachedRates(fromCode);
  if (own.signal.aborted) return;
  if (cached) {
    table = cached;
    status = navigator.onLine
      ? isFresh(cached.fetchedAt)
        ? "fresh"
        : "stale"
      : "offline";
    log(`Loaded cached ${cached.base} rates`);
    renderConversion();
  }
  // navigator.onLine is a hint only — always attempt the network when needed.
  if (!force && cached && isFresh(cached.fetchedAt)) return;
  const started = performance.now();
  status = table ? "refreshing" : "loading";
  renderStatus();
  log(`Fetching ${fromCode} rates`);
  try {
    const loaded = await provider.getRates(fromCode, own.signal);
    if (own.signal.aborted || loaded.base !== fromCode) return;
    if (!loaded.rates[toCode])
      throw new Error(`No current rate is available for ${fromCode} → ${toCode}.`);
    table = loaded;
    requestDuration = Math.round(performance.now() - started);
    await setCachedRates(loaded);
    status = "fresh";
    lastError = "None";
    lastFetchFailed = false;
    log(`Loaded ${Object.keys(loaded.rates).length} valid rates`);
  } catch (error) {
    if (own.signal.aborted) return;
    lastFetchFailed = true;
    lastError =
      error instanceof Error ? error.message : "Rates are temporarily unavailable.";
    if (table) status = navigator.onLine ? "stale" : "offline";
    else status = navigator.onLine ? "error" : "offline";
    log(lastError);
  }
  renderConversion();
  renderDebug();
}

/* ---------- currency picker ---------- */

function paintCurrencyPickerSelection() {
  const selected = currencyPickerTarget === "from" ? fromCode : toCode;
  const other = currencyPickerTarget === "from" ? toCode : fromCode;
  currencyPicker.querySelectorAll<HTMLButtonElement>(".currency-option").forEach((btn) => {
    const active = btn.dataset.code === selected;
    btn.setAttribute("aria-current", String(active));
    btn.classList.toggle("is-selected", active);
    const isOther = btn.dataset.code === other;
    btn.classList.toggle("is-other", isOther);
    const c = getCurrency(btn.dataset.code ?? "");
    btn.setAttribute(
      "aria-label",
      `${c?.code} ${c?.name}${isOther ? ", selecting swaps the pair" : ""}`,
    );
  });
}

const RECENTS_KEY = "deac-currency-recents-v1";
function loadRecents(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string" && !!getCurrency(c)) : [];
  } catch {
    return [];
  }
}
function pushRecent(code: string) {
  const list = [code, ...loadRecents().filter((c) => c !== code)].slice(0, 6);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* non-fatal */
  }
}
function renderRecents() {
  const selected = currencyPickerTarget === "from" ? fromCode : toCode;
  const codes = loadRecents().filter((c) => c !== selected).slice(0, 4);
  byId("currency-recents").hidden = codes.length === 0 || Boolean(currencySearch.value.trim());
  byId("currency-recents-row").innerHTML = codes
    .map((c) => `<button type="button" class="recent-chip" data-code="${c}" aria-label="Recent: ${c} ${nameOf(c)}">${c}</button>`)
    .join("");
}

/** Enter picks the best match: exact code, then code prefix, then name prefix, then anything. */
function bestMatch(): string | undefined {
  const q = currencySearch.value.trim().toLowerCase();
  const visible = [...currencyPicker.querySelectorAll<HTMLButtonElement>(".currency-option:not([hidden])")];
  const score = (b: HTMLButtonElement) => {
    const code = (b.dataset.code ?? "").toLowerCase();
    const name = getCurrency(b.dataset.code ?? "")?.name.toLowerCase() ?? "";
    if (code === q) return 0;
    if (code.startsWith(q)) return 1;
    if (name.startsWith(q)) return 2;
    if (name.includes(q)) return 3;
    return 4;
  };
  return visible.sort((a, b) => score(a) - score(b))[0]?.dataset.code;
}

function filterCurrencies() {
  const q = currencySearch.value.trim().toLowerCase();
  let shown = 0;
  currencyPicker.querySelectorAll<HTMLElement>(".currency-group").forEach((group) => {
    let groupShown = 0;
    group.querySelectorAll<HTMLButtonElement>(".currency-option").forEach((btn) => {
      const match = !q || (btn.dataset.search ?? "").includes(q);
      btn.hidden = !match;
      if (match) groupShown += 1;
    });
    group.hidden = groupShown === 0;
    shown += groupShown;
    const visible = group.querySelectorAll<HTMLButtonElement>(".currency-option:not([hidden])");
    group.querySelectorAll(".currency-option").forEach((b) => b.classList.remove("is-last"));
    visible[visible.length - 1]?.classList.add("is-last");
  });
  byId("currency-empty").hidden = shown > 0;
  renderRecents();
}

function openCurrencyPicker(target: "from" | "to") {
  currencyPickerTarget = target;
  currencyPickerTitle.textContent = target === "from" ? "FROM CURRENCY" : "TO CURRENCY";
  currencySearch.value = "";
  filterCurrencies();
  paintCurrencyPickerSelection();
  currencyPicker.showModal();
  const selected = currencyPicker.querySelector<HTMLButtonElement>(".currency-option.is-selected");
  selected?.scrollIntoView({ block: "center" });
  (selected ?? currencyPicker.querySelector<HTMLElement>(".close"))?.focus({ preventScroll: true });
}

function closeCurrencyPicker() {
  if (!currencyPicker.open) return;
  currencyPicker.close();
  currencyPickerTarget = null;
}

function applyCurrencyPick(code: string) {
  if (!currencyPickerTarget || !getCurrency(code)) return;
  const target = currencyPickerTarget;
  const current = target === "from" ? fromCode : toCode;
  const other = target === "from" ? toCode : fromCode;
  closeCurrencyPicker();
  pushRecent(code);
  if (code === current) return;
  if (code === other) {
    // Picking the other side's currency swaps the pair.
    [fromCode, toCode] = [toCode, fromCode];
  } else if (target === "from") {
    fromCode = code;
  } else {
    toCode = code;
    syncCurrencyTriggers();
    renderConversion();
    announce(`${nameOf(fromCode)} to ${nameOf(toCode)}`);
    if (!table?.rates[toCode]) void loadRates(true);
    return;
  }
  syncCurrencyTriggers();
  table = null;
  status = "loading"; // not "NO RATE" while the new base's rates load
  renderConversion();
  announce(`${nameOf(fromCode)} to ${nameOf(toCode)}`);
  void loadRates();
}

/* ---------- events: converter ---------- */

/** A paste like "R50 - R100" or "Total: 1,250.50 (15% VAT)" keeps its first number. */
function firstNumberOnPaste(input: HTMLInputElement, event: Event) {
  if ((event as InputEvent).inputType !== "insertFromPaste") return;
  const match = /\d[\d.,\s\u00a0\u202f'’]*\d|\d/.exec(input.value);
  if (match) input.value = match[0];
}

amount.addEventListener("input", (event) => {
  clipped = false;
  firstNumberOnPaste(amount, event);
  sanitize(amount);
  source = "top";
  renderConversion();
  announce();
});
result.addEventListener("input", (event) => {
  clipped = false;
  firstNumberOnPaste(result, event);
  sanitize(result);
  source = "bottom";
  renderConversion();
  announce();
});
for (const input of [amount, result]) {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
  });
  input.addEventListener("focus", () => ungroupOnFocus(input));
  input.addEventListener("blur", () => {
    const isSource = (source === "top" ? amount : result) === input;
    if (isSource) {
      groupOnBlur(input);
      save();
    } else {
      renderConversion(); // restore the computed value's formatting
    }
  });
}

// Copy the computed amount as shown, minus grouping, so it pastes as a number.
for (const [btnId, input] of [["amount-copy", amount], ["result-copy", result]] as const) {
  const btn = byId<HTMLButtonElement>(btnId);
  let resetTimer = 0;
  btn.addEventListener("click", async () => {
    if (!input.value) return;
    const code = input === amount ? fromCode : toCode;
    window.clearTimeout(resetTimer);
    try {
      await navigator.clipboard.writeText(copyValue(input.value));
      btn.textContent = "COPIED";
      say(`Copied ${input.value} ${nameOf(code)}`);
    } catch {
      btn.textContent = "CAN'T COPY";
      say("Couldn't copy");
    }
    resetTimer = window.setTimeout(() => (btn.textContent = "COPY"), 1400);
  });
}

// Touch taps shouldn't leave keyboard-style focus rings behind (e.g. on the
// gear after a sheet closes); a hardware keyboard brings them back.
document.addEventListener(
  "pointerdown",
  () => (document.documentElement.dataset.input = "touch"),
  true,
);
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Tab" || event.key.startsWith("Arrow"))
      document.documentElement.dataset.input = "keys";
  },
  true,
);
// Tap anywhere outside a field to put the keyboard away.
document.addEventListener("pointerdown", (event) => {
  const active = document.activeElement;
  if (
    (active === amount || active === result) &&
    !(event.target as HTMLElement).closest(".well")
  ) {
    (active as HTMLInputElement).blur();
  }
});

fromTrigger.addEventListener("click", () => openCurrencyPicker("from"));
toTrigger.addEventListener("click", () => openCurrencyPicker("to"));
swapButton.addEventListener("click", () => {
  // Flip direction — currencies stay put and the typed amount carries over.
  // 1 FROM = X TO  →  Y FROM = 1 TO;  100 FROM = X TO  →  Y FROM = 100 TO.
  const sourceInput = source === "top" ? amount : result;
  const typed = sourceInput.value.trim();
  const carried = typed && parse(typed).valid ? typed : "1";
  if (source === "top") {
    result.value = carried;
    source = "bottom";
  } else {
    amount.value = carried;
    source = "top";
  }
  swapButton.classList.remove("is-flipping");
  void swapButton.offsetWidth;
  swapButton.classList.add("is-flipping");
  renderConversion();
  announce(`Now typing ${nameOf(source === "top" ? fromCode : toCode)}`);
});
swapButton.addEventListener("animationend", () => swapButton.classList.remove("is-flipping"));
statusButton.addEventListener("click", () => void refreshByUser());

/** A refresh the user asked for, spoken when it lands. */
async function refreshByUser() {
  await loadRates(true);
  if (status === "fresh" && table) say(`Rates updated, ${whenLabel(table.fetchedAt)}`);
  else if (lastFetchFailed) say("Couldn't update rates");
}

/* ---------- events: dialogs ---------- */

function wireSheet(dialog: HTMLDialogElement, onClose: () => void = () => dialog.close()) {
  dialog.querySelector<HTMLButtonElement>(".sheet-head .close")?.addEventListener("click", onClose);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) onClose();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    onClose();
  });
}

wireSheet(currencyPicker, closeCurrencyPicker);
currencySearch.addEventListener("input", filterCurrencies);
currencySearch.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    // search inputs swallow Escape to clear themselves; close the sheet instead
    event.preventDefault();
    closeCurrencyPicker();
    return;
  }
  if (event.key !== "Enter") return;
  // consume the key, or it re-activates the trigger that regains focus on close
  event.preventDefault();
  const code = bestMatch();
  if (code) applyCurrencyPick(code);
});
currencyPicker.addEventListener("click", (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(".currency-option, .recent-chip");
  if (!btn?.dataset.code) return;
  applyCurrencyPick(btn.dataset.code);
});

if (tipDialog) {
  wireSheet(tipDialog);
  byId("tip-open").addEventListener("click", () => {
    tipDialog.showModal();
    tipDialog.querySelector<HTMLElement>(".close")?.focus({ preventScroll: true });
  });
}

function commitTheme(next: DesignTheme) {
  designTheme = themeWithCustomFlag(next);
  applyTheme(designTheme);
  saveDesignTheme(designTheme);
  syncDesignControls();
}

function syncDesignControls() {
  designDialog.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
    btn.setAttribute("aria-checked", String(btn.dataset.preset === designTheme.presetId));
  });
}

wireSheet(designDialog);
designOpen.addEventListener("click", () => {
  syncDesignControls();
  renderStatus();
  designDialog.showModal();
  designDialog.querySelector<HTMLElement>(".close")?.focus({ preventScroll: true });
});
designDialog.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.preset as Exclude<DesignTheme["presetId"], "custom"> | undefined;
    if (id) commitTheme(getPresetTheme(id));
  });
});
byId("settings-refresh").addEventListener("click", () => void refreshByUser());

wireSheet(debugPanel);
byId("debug-open").addEventListener("click", () => {
  designDialog.close();
  renderDebug();
  debugPanel.showModal();
  debugPanel.querySelector<HTMLElement>(".close")?.focus({ preventScroll: true });
});

/* ---------- diagnostics ---------- */

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    log("Copied report to clipboard");
  } catch {
    lastError = "Clipboard access was denied.";
    log(lastError);
  }
}

function renderDebug() {
  const age = table
    ? `${Math.floor((Date.now() - table.fetchedAt) / 1000)} s`
    : "Not available";
  const rows: [string, string][] = [
    ["Version", __APP_VERSION__],
    ["Shell", isTauri ? `Tauri ${tauriPlatform || "desktop"}` : "Browser"],
    ["Connection", navigator.onLine ? "Online" : "Offline"],
    ["Provider", table?.provider ?? "Coinbase"],
    ["Base", fromCode],
    ["Rates", String(table ? Object.keys(table.rates).length : 0)],
    ["Last fetch", table ? new Date(table.fetchedAt).toLocaleString() : "Never"],
    ["Cache age", age],
    ...(isTauri
      ? []
      : ([
          ["Service worker", navigator.serviceWorker?.controller ? "Active" : "Not controlling"],
          [
            "PWA",
            matchMedia("(display-mode: standalone)").matches
              ? "Installed"
              : deferredInstall
                ? "Available"
                : "Browser",
          ],
        ] as [string, string][])),
    ["Request", requestDuration === null ? "Not available" : `${requestDuration} ms`],
    ["Last error", lastError],
  ];
  const node = byId("debug-content");
  if (node)
    node.innerHTML = `<dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  const session = byId("session-log");
  if (session) session.textContent = logs.join("\n") || "No session events yet.";
}
byId("debug-refresh").addEventListener("click", () => void loadRates(true));
byId("clear-cache").addEventListener("click", async () => {
  await clearRateCache();
  log("Rate cache cleared");
});
byId("copy-diagnostics").addEventListener(
  "click",
  () => void copyText(`${byId("debug-content").innerText}\n${logs.join("\n")}`),
);

/* ---------- lifecycle ---------- */

window.addEventListener("online", () => {
  log("Connection restored");
  void loadRates(true);
});
window.addEventListener("offline", () => {
  status = "offline";
  log("Browser is offline");
  renderStatus();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (table && !isFresh(table.fetchedAt)) void loadRates();
  else renderStatus();
});
window.setInterval(() => {
  if (table && status === "fresh" && !isFresh(table.fetchedAt)) status = "stale";
  renderStatus();
  // keep rates current while the app is open and in front
  if (document.visibilityState === "visible" && table && !isFresh(table.fetchedAt)) void loadRates();
}, 60_000);

if (!isTauri) {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event as BeforeInstallPromptEvent;
    byId("install-app").hidden = false;
    renderDebug();
  });
  byId("install-app").addEventListener("click", () => void deferredInstall?.prompt());

  const updateSW = registerSW({
    onNeedRefresh() {
      byId("update-toast").hidden = false;
    },
    onOfflineReady() {
      log("App is ready for offline use");
    },
    onRegisterError() {
      lastError = "Offline support could not be started.";
      log(lastError);
    },
  });
  byId("update-app").addEventListener("click", () => void updateSW(true));
}

/* ---------- large text ---------- */

const TEXT_KEY = "deac-currency-large-text";
/** iOS reports the Dynamic Type size through -apple-system-body (17px by default). */
function systemPrefersLargeText() {
  const probe = document.createElement("span");
  probe.style.cssText = "font: -apple-system-body; position: absolute; visibility: hidden;";
  document.body.append(probe);
  const size = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return Number.isFinite(size) && size >= 20;
}
function applyTextSize() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(TEXT_KEY);
  } catch {
    /* ignore */
  }
  const large = stored === null ? systemPrefersLargeText() : stored === "on";
  document.documentElement.dataset.text = large ? "large" : "normal";
  byId("large-text").setAttribute("aria-checked", String(large));
  fitInput(amount);
  fitInput(result);
}
byId("large-text").addEventListener("click", () => {
  const next = document.documentElement.dataset.text !== "large";
  try {
    localStorage.setItem(TEXT_KEY, next ? "on" : "off");
  } catch {
    /* ignore */
  }
  applyTextSize();
});
applyTextSize();

new ResizeObserver(() => {
  fitInput(amount);
  fitInput(result);
}).observe(amount);

log("Application started");
syncCurrencyTriggers();
paintFields();
renderStatus();
renderDebug();
void loadRates();
