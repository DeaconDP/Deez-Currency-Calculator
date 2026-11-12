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
let requestDuration: number | null = null;
let abortController: AbortController | null = null;
let deferredInstall: BeforeInstallPromptEvent | null = null;
let source: "top" | "bottom" = prefs.source;
const logs: string[] = [];

const app = document.querySelector<HTMLDivElement>("#app")!;
let fromCode = prefs.from;
let toCode = prefs.to;
let currencyPickerTarget: "from" | "to" | null = null;

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
    [7, 0, 2, 3], [7, 13, 2, 3], [0, 7, 3, 2], [13, 7, 3, 2],
    [2, 2, 2, 2], [12, 2, 2, 2], [2, 12, 2, 2], [12, 12, 2, 2],
    [4, 4, 8, 2], [4, 10, 8, 2], [4, 4, 2, 8], [10, 4, 2, 8],
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
  [[6, 1, 1, 1], [5, 2, 2, 1], [4, 3, 2, 1], [0, 3, 1, 1], [0, 4, 2, 1], [1, 5, 4, 1], [2, 6, 2, 1]],
  "icon-check",
);
const rightIcon = pixelIcon(8, 16, [[2, 1, 1, 6], [3, 2, 1, 4], [4, 3, 1, 2]], "icon-right");

/* ---------- markup ---------- */

const upper = (s: string) => s.toUpperCase();

const currencyPickerListMarkup = (["fiat", "crypto"] as const)
  .map((type) => {
    const label = type === "fiat" ? "Fiat" : "Crypto";
    const rows = currencies
      .filter((c) => c.type === type)
      .map(
        (c) =>
          `<button type="button" class="currency-option" data-code="${c.code}" data-search="${c.code.toLowerCase()} ${c.name.toLowerCase()}" aria-label="${c.code} ${c.name}">
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
      <span class="leg-label" id="${inputId}-label"><span class="leg-dir">${which === "top" ? "FROM" : "TO"}</span><span class="leg-name" id="${inputId}-name"></span></span>
      <span id="${inputId}-error" class="field-error"></span>
    </div>
    <div class="leg-row">
      <div class="well">
        <span class="approx" aria-hidden="true">≈</span>
        <input id="${inputId}" inputmode="decimal" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" value="${value}" aria-describedby="${inputId}-error">
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
        <img class="brand-mark" src="/sprites/btc-chart.png" alt="" width="32" height="32">
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
        </span>
        <span id="status-rate" class="status-rate"></span>
        <span id="status-inverse" class="status-rate status-inverse"></span>
        <span id="status-hint" class="status-hint"></span>
      </button>
      <p id="main-error" class="sr-only" role="alert"></p>
      <p id="announce" class="sr-only" role="status" aria-live="polite"></p>
    </section>
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

/** Select all on focus so a tap is ready to replace. */
function selectAllOnFocus(input: HTMLInputElement) {
  input.addEventListener("focus", () => {
    requestAnimationFrame(() => input.select());
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
    `From currency: ${fromCode}${fromCurrency ? ` ${fromCurrency.name}` : ""}. Change`,
  );
  toTrigger.setAttribute(
    "aria-label",
    `To currency: ${toCode}${toCurrency ? ` ${toCurrency.name}` : ""}. Change`,
  );
  amount.setAttribute("aria-label", `Amount in ${fromCurrency?.name ?? fromCode}`);
  result.setAttribute("aria-label", `Amount in ${toCurrency?.name ?? toCode}`);
}

/** Typed field = bright; computed field = accent with ≈. Long numbers step down a size. */
function paintFields() {
  const top = app.querySelector<HTMLElement>('[data-leg="top"]')!;
  const bottom = app.querySelector<HTMLElement>('[data-leg="bottom"]')!;
  top.classList.toggle("is-driven", source === "bottom");
  bottom.classList.toggle("is-driven", source === "top");
  for (const input of [amount, result]) {
    input.classList.toggle("is-long", input.value.length > 11);
  }
}

let announceTimer = 0;
function announce() {
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    if (!amount.value || !result.value) return;
    const from = getCurrency(fromCode)?.name ?? fromCode;
    const to = getCurrency(toCode)?.name ?? toCode;
    byId("announce").textContent = `${amount.value} ${from} is ${result.value} ${to}`;
  }, 700);
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
  const parsed = parseAmount(sourceInput.value);

  drivenError.textContent = "";
  sourceError.textContent =
    sourceInput.value && !parsed.valid ? shortReason(parsed.reason) : "";
  sourceInput.closest(".well")!.classList.toggle(
    "is-invalid",
    Boolean(sourceInput.value && !parsed.valid),
  );
  drivenInput.closest(".well")!.classList.remove("is-invalid");

  if (!sourceInput.value) {
    drivenInput.value = "";
  } else if (parsed.valid && rate && drivenCurrency) {
    const mid =
      source === "top"
        ? calculate(parsed.normalized, rate)!
        : calculateInverse(parsed.normalized, rate)!;
    drivenInput.value = formatResult(mid, drivenCurrency);
  } else if (!parsed.valid) {
    // keep the last good value visible but dimmed while the input is fixed
  } else {
    drivenInput.value = "";
  }
  drivenInput.closest(".well")!.classList.toggle(
    "is-dim",
    Boolean(sourceInput.value && !parsed.valid),
  );

  paintFields();
  renderStatus();
  announce();
  save();
}

function shortReason(reason: string) {
  if (/18 significant/.test(reason)) return "TOO LONG";
  return "NUMBERS ONLY";
}

/** Strip anything that can't be part of a number as it's typed. */
function sanitize(input: HTMLInputElement) {
  const cleaned = input.value.replace(/[^\d.,\s]/g, "");
  if (cleaned !== input.value) input.value = cleaned;
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
      hint = "TAP TO REFRESH";
      break;
    case "stale":
      label = "CACHED";
      hint = "TAP TO REFRESH";
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
    [label, byId("status-rate").textContent, when ? `updated ${when}` : "", hint]
      .filter(Boolean)
      .join(". "),
  );
  statusButton.setAttribute("aria-busy", String(refreshing));
  byId("main-error").textContent = kind === "error" ? hint.replace(" · TAP TO RETRY", "") : "";
  byId("settings-updated").textContent = when ? `UPDATED ${when}` : "";
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
    log(`Loaded ${Object.keys(loaded.rates).length} valid rates`);
  } catch (error) {
    if (own.signal.aborted) return;
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
    btn.classList.toggle("is-other", btn.dataset.code === other);
  });
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
  });
  byId("currency-empty").hidden = shown > 0;
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
    if (!table?.rates[toCode]) void loadRates(true);
    return;
  }
  syncCurrencyTriggers();
  table = null;
  renderConversion();
  void loadRates();
}

/* ---------- events: converter ---------- */

amount.addEventListener("input", () => {
  sanitize(amount);
  source = "top";
  renderConversion();
});
result.addEventListener("input", () => {
  sanitize(result);
  source = "bottom";
  renderConversion();
});
for (const input of [amount, result]) {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
  });
}
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
  const carried = typed && parseAmount(typed).valid ? typed : "1";
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
});
swapButton.addEventListener("animationend", () => swapButton.classList.remove("is-flipping"));
statusButton.addEventListener("click", () => void loadRates(true));

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
  const first = currencyPicker.querySelector<HTMLButtonElement>(".currency-option:not([hidden])");
  if (first?.dataset.code) applyCurrencyPick(first.dataset.code);
});
byId("currency-picker-list").addEventListener("click", (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>(".currency-option");
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
byId("settings-refresh").addEventListener("click", () => void loadRates(true));

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

log("Application started");
syncCurrencyTriggers();
paintFields();
renderStatus();
renderDebug();
void loadRates();
