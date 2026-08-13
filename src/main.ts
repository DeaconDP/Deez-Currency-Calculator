import "./styles.css";
import { registerSW } from "virtual:pwa-register";
import { CoinbaseProvider } from "./api/coinbase";
import { calculate, calculateInverse } from "./conversion/calculate";
import { formatResult } from "./conversion/format";
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
  DEFAULT_DESIGN_THEME,
  NAMED_PRESETS,
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
let debugOpen = false;
let source: "top" | "bottom" = prefs.source;
const logs: string[] = [];

const app = document.querySelector<HTMLDivElement>("#app")!;
const options = (selected: string) =>
  ["fiat", "crypto"]
    .map(
      (type) =>
        `<optgroup label="${type === "fiat" ? "Fiat currencies" : "Cryptocurrencies"}">${currencies
          .filter((c) => c.type === type)
          .map(
            (c) =>
              `<option value="${c.code}" ${c.code === selected ? "selected" : ""}>${c.code}</option>`,
          )
          .join("")}</optgroup>`,
    )
    .join("");

const tipCards = tipDestinations
  .map(
    (tip) =>
      `<figure class="tip-card"><img src="${tip.qrAssetPath}" alt="${tip.asset} donation QR code" width="394" height="394"><figcaption>${tip.label}</figcaption></figure>`,
  )
  .join("");

type ColorKey =
  | "background"
  | "surface"
  | "control"
  | "controlText"
  | "text"
  | "muted"
  | "money"
  | "error"
  | "focus";

const colorFields: { key: ColorKey; label: string; id: string }[] = [
  { key: "background", label: "Background", id: "design-background" },
  { key: "surface", label: "Surface", id: "design-surface" },
  { key: "control", label: "Controls", id: "design-control" },
  { key: "controlText", label: "Control text", id: "design-control-text" },
  { key: "text", label: "Text", id: "design-text" },
  { key: "muted", label: "Muted", id: "design-muted" },
  { key: "money", label: "Accent", id: "design-money" },
  { key: "error", label: "Error", id: "design-error" },
  { key: "focus", label: "Focus", id: "design-focus" },
];

const colorFieldMarkup = colorFields
  .map(
    ({ key, label, id }) => `
      <div class="design-field">
        <label for="${id}">${label}</label>
        <div class="design-color-row">
          <input id="${id}" type="color" value="${designTheme[key]}" data-theme-key="${key}" aria-label="${label} color">
          <input id="${id}-hex" type="text" value="${designTheme[key]}" maxlength="7" spellcheck="false" data-theme-hex="${key}" aria-label="${label} hex">
        </div>
      </div>`,
  )
  .join("");

const presetMarkup = NAMED_PRESETS.map(
  (id) =>
    `<button type="button" class="design-preset" data-preset="${id}" aria-pressed="${designTheme.presetId === id}">${id.replace("-", " ").toUpperCase()}</button>`,
).join("");

app.innerHTML = `
  <main class="shell">
    <header class="brand" aria-label="Deez Currency Calculator">
      <h1><span>DEEZ</span><span>CURRENCY</span><span>CALCULATOR</span></h1>
      <img class="brand-mark" src="/sprites/money-bag.png" alt="" width="96" height="80">
    </header>
    <section class="converter" aria-labelledby="converter-title">
      <h2 id="converter-title" class="sr-only">Currency calculator</h2>
      <div class="conversion-grid">
        <div class="row">
          <div class="field amount-field">
            <label class="sr-only" for="amount">Amount</label>
            <input id="amount" inputmode="decimal" autocomplete="off" value="${prefs.amount}" aria-describedby="amount-error">
            <span id="amount-error" class="error"></span>
          </div>
          <div class="field currency-field">
            <label class="sr-only" for="from">From currency</label>
            <select id="from">${options(prefs.from)}</select>
          </div>
        </div>
        <div class="swap-row">
          <button id="swap" class="swap" type="button" aria-label="Swap ${prefs.from} and ${prefs.to}" title="Swap currencies">
            <svg class="swap-icon" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" shape-rendering="crispEdges">
              <!-- left arrow up -->
              <rect x="4" y="1" width="2" height="2"/>
              <rect x="2" y="3" width="6" height="2"/>
              <rect x="4" y="5" width="2" height="10"/>
              <!-- right arrow down -->
              <rect x="10" y="1" width="2" height="10"/>
              <rect x="8" y="11" width="6" height="2"/>
              <rect x="10" y="13" width="2" height="2"/>
            </svg>
          </button>
        </div>
        <div class="row">
          <div class="field amount-field">
            <label class="sr-only" for="result">Converted amount</label>
            <input id="result" inputmode="decimal" autocomplete="off" aria-live="polite" aria-describedby="result-error" value="${prefs.result}">
            <span id="result-error" class="error"></span>
          </div>
          <div class="field currency-field">
            <label class="sr-only" for="to">To currency</label>
            <select id="to">${options(prefs.to)}</select>
          </div>
        </div>
      </div>
      <p id="main-error" class="main-error" role="alert"></p>
    </section>
    <nav class="bottom-actions" aria-label="App actions">
      <button id="debug-open" class="action debug" type="button" aria-pressed="false" aria-controls="debug-panel">
        <img src="/sprites/debug-alien.png" alt="" width="40" height="34">
        <span>DEBUG</span>
      </button>
      <button id="tip-open" class="action tip" type="button">
        <img src="/sprites/tip-heart.png" alt="" width="40" height="34">
        <span>TIP</span>
      </button>
      <button id="design-open" class="action settings" type="button" aria-label="Design settings" aria-haspopup="dialog" aria-controls="design-dialog">
        <span class="action-glyph" aria-hidden="true">
          <svg class="settings-icon" viewBox="0 0 16 16" width="40" height="34" shape-rendering="crispEdges">
            <!-- left arrow up -->
            <rect x="4" y="1" width="2" height="2"/>
            <rect x="2" y="3" width="6" height="2"/>
            <rect x="4" y="5" width="2" height="10"/>
            <!-- right arrow down -->
            <rect x="10" y="1" width="2" height="10"/>
            <rect x="8" y="11" width="6" height="2"/>
            <rect x="10" y="13" width="2" height="2"/>
          </svg>
        </span>
        <span>SETTINGS</span>
      </button>
    </nav>
    <section
      id="debug-panel"
      class="debug-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="debug-title"
      aria-hidden="true"
    >
      <h2 id="debug-title" class="debug-title">DEBUG LOG</h2>
      <pre id="session-log" tabindex="0"></pre>
      <div class="debug-actions">
        <button id="debug-refresh" type="button">Refresh rates</button>
        <button id="clear-cache" type="button">Clear cache</button>
        <button id="copy-diagnostics" type="button">Copy diagnostics</button>
        <button id="install-app" type="button" hidden>Install app</button>
      </div>
      <div id="debug-content" class="debug-meta sr-only" aria-hidden="true"></div>
    </section>
  </main>
  <dialog id="tip-dialog" class="tip-dialog" aria-labelledby="tip-title">
    <button class="close tip-close" type="button" aria-label="Close tip screen">×</button>
    <div class="tip-body">
      <h2 id="tip-title"><span>TIP IF</span><span>YOU'RE</span><span>COOL</span></h2>
      <img class="tip-check" src="/sprites/tip-check.png" alt="" width="72" height="72">
      <div class="tip-qr-well">${tipCards}</div>
    </div>
  </dialog>
  <dialog id="design-dialog" class="design-dialog" aria-labelledby="design-title">
    <button class="close design-close" type="button" aria-label="Close design settings">×</button>
    <div class="design-body">
      <h2 id="design-title" class="design-title">DESIGN</h2>
      <p class="design-hint">Pick a look, or open a section to tweak colors, type, and spacing.</p>
      <div class="design-presets" role="group" aria-label="Design presets">${presetMarkup}</div>
      <button id="design-reset" class="design-reset" type="button">Reset to default</button>
      <details class="design-section">
        <summary>Colors</summary>
        <div class="design-fields">${colorFieldMarkup}</div>
      </details>
      <details class="design-section">
        <summary>Type</summary>
        <div class="design-fields">
          <div class="design-field">
            <label for="design-ui-scale">Size <span id="design-ui-scale-value" class="design-range-value">${Math.round(designTheme.uiScale * 100)}%</span></label>
            <input id="design-ui-scale" type="range" min="0.75" max="1.4" step="0.05" value="${designTheme.uiScale}">
          </div>
          <div class="design-toggle-row">
            <span id="design-pixel-label">Pixel font</span>
            <button id="design-pixel-font" class="design-toggle" type="button" role="switch" aria-checked="${designTheme.font === "pixel"}" aria-labelledby="design-pixel-label"></button>
          </div>
        </div>
      </details>
      <details class="design-section">
        <summary>Shape</summary>
        <div class="design-fields">
          <div class="design-field">
            <label for="design-radius">Corners <span id="design-radius-value" class="design-range-value">${designTheme.radius}px</span></label>
            <input id="design-radius" type="range" min="0" max="24" step="1" value="${designTheme.radius}">
          </div>
        </div>
      </details>
      <details class="design-section">
        <summary>Density</summary>
        <div class="design-fields">
          <div class="design-field">
            <label for="design-space">Spacing <span id="design-space-value" class="design-range-value">${Math.round(designTheme.space * 100)}%</span></label>
            <input id="design-space" type="range" min="0.6" max="1.4" step="0.05" value="${designTheme.space}">
          </div>
          <div class="design-field">
            <label for="design-control-height">Control height <span id="design-control-height-value" class="design-range-value">${designTheme.controlHeight}px</span></label>
            <input id="design-control-height" type="range" min="40" max="64" step="2" value="${designTheme.controlHeight}">
          </div>
        </div>
      </details>
    </div>
  </dialog>
  <aside id="update-toast" hidden>A new version is available. <button id="update-app" type="button">Update</button></aside>`;

const amount = byId<HTMLInputElement>("amount");
const result = byId<HTMLInputElement>("result");
const from = byId<HTMLSelectElement>("from");
const to = byId<HTMLSelectElement>("to");
const debugPanel = byId("debug-panel");
const debugButton = byId<HTMLButtonElement>("debug-open");
const tipDialog = byId<HTMLDialogElement>("tip-dialog");
const designDialog = byId<HTMLDialogElement>("design-dialog");
const designOpen = byId<HTMLButtonElement>("design-open");
const pixelFontToggle = byId<HTMLButtonElement>("design-pixel-font");

function byId<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
function log(message: string) {
  logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  if (logs.length > 100) logs.shift();
  renderDebug();
}
function save() {
  savePreferences({
    amount: amount.value,
    result: result.value,
    from: from.value,
    to: to.value,
    source,
  });
}

function setDebugOpen(open: boolean) {
  debugOpen = open;
  debugPanel.classList.toggle("is-open", open);
  debugPanel.setAttribute("aria-hidden", String(!open));
  debugButton.setAttribute("aria-pressed", String(open));
  if (open) renderDebug();
}

function renderConversion() {
  const rate = table?.rates[to.value];
  const fromCurrency = getCurrency(from.value);
  const toCurrency = getCurrency(to.value);
  const sourceInput = source === "top" ? amount : result;
  const drivenInput = source === "top" ? result : amount;
  const sourceError = byId(source === "top" ? "amount-error" : "result-error");
  const drivenError = byId(source === "top" ? "result-error" : "amount-error");
  const drivenCurrency = source === "top" ? toCurrency : fromCurrency;
  const parsed = parseAmount(sourceInput.value);

  drivenError.textContent = "";
  sourceError.textContent =
    sourceInput.value && !parsed.valid ? parsed.reason : "";

  if (!sourceInput.value) {
    drivenInput.value = "";
  } else if (parsed.valid && rate && drivenCurrency) {
    const raw =
      source === "top"
        ? calculate(sourceInput.value, rate)!
        : calculateInverse(sourceInput.value, rate)!;
    drivenInput.value = formatResult(raw, drivenCurrency);
  } else if (!rate && parsed.valid) {
    drivenInput.value = "";
    drivenError.textContent = "Unavailable";
  } else {
    drivenInput.value = "";
  }

  renderStatus();
  save();
}

function renderStatus() {
  byId("main-error").textContent = status === "error" ? lastError : "";
}

async function loadRates(force = false) {
  abortController?.abort();
  const own = new AbortController();
  abortController = own;
  status = table ? "refreshing" : "loading";
  renderStatus();
  const cached = await getCachedRates(from.value);
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
  log(`Fetching ${from.value} rates`);
  try {
    const loaded = await provider.getRates(from.value, own.signal);
    if (own.signal.aborted || loaded.base !== from.value) return;
    if (!loaded.rates[to.value])
      throw new Error(
        `No current rate is available for ${from.value} → ${to.value}.`,
      );
    table = loaded;
    requestDuration = Math.round(performance.now() - started);
    await setCachedRates(loaded);
    status = "fresh";
    lastError = "None";
    log(`Loaded ${Object.keys(loaded.rates).length} valid rates`);
  } catch (error) {
    if (own.signal.aborted) return;
    lastError =
      error instanceof Error
        ? error.message
        : "Rates are temporarily unavailable.";
    if (table) status = "stale";
    else status = navigator.onLine ? "error" : "offline";
    log(lastError);
  }
  renderConversion();
  renderDebug();
}

amount.addEventListener("input", () => {
  source = "top";
  renderConversion();
});
result.addEventListener("input", () => {
  source = "bottom";
  renderConversion();
});
from.addEventListener("change", () => {
  table = null;
  save();
  void loadRates();
});
to.addEventListener("change", () => {
  renderConversion();
  if (!table?.rates[to.value]) void loadRates(true);
});
byId("swap").addEventListener("click", () => {
  const oldFrom = from.value;
  from.value = to.value;
  to.value = oldFrom;
  source = "top";
  table = null;
  byId("swap").setAttribute("aria-label", `Swap ${from.value} and ${to.value}`);
  save();
  void loadRates();
});

debugButton.addEventListener("click", () => setDebugOpen(!debugOpen));
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    debugOpen &&
    !tipDialog.open &&
    !designDialog.open
  ) {
    setDebugOpen(false);
  }
});
let tipClosing = false;

function focusTipClose() {
  const closeBtn = tipDialog.querySelector<HTMLElement>(".close");
  if (!closeBtn) return;
  try {
    closeBtn.focus({
      preventScroll: true,
      focusVisible: false,
    } as FocusOptions);
  } catch {
    closeBtn.focus({ preventScroll: true });
  }
}

function openTipDialog() {
  tipClosing = false;
  tipDialog.classList.remove("is-closing");
  tipDialog.showModal();
  focusTipClose();
}

function closeTipDialog() {
  if (!tipDialog.open || tipClosing) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  if (reduceMotion) {
    tipDialog.classList.remove("is-closing");
    tipDialog.close();
    return;
  }
  tipClosing = true;
  tipDialog.classList.add("is-closing");
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    tipDialog.close();
    tipDialog.classList.remove("is-closing");
    tipClosing = false;
  };
  tipDialog.addEventListener("animationend", (event) => {
    if (event.target === tipDialog) finish();
  }, { once: true });
  window.setTimeout(finish, 280);
}

byId("tip-open").addEventListener("click", () => openTipDialog());
tipDialog.querySelector<HTMLButtonElement>(".close")?.addEventListener(
  "click",
  () => closeTipDialog(),
);
tipDialog.addEventListener("click", (event) => {
  if (event.target === tipDialog) closeTipDialog();
});
tipDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeTipDialog();
});

function commitTheme(next: DesignTheme) {
  designTheme = themeWithCustomFlag(next);
  applyTheme(designTheme);
  saveDesignTheme(designTheme);
  syncDesignControls();
}

function syncDesignControls() {
  for (const { key, id } of colorFields) {
    const color = designTheme[key];
    const picker = byId<HTMLInputElement>(id);
    const hex = byId<HTMLInputElement>(`${id}-hex`);
    picker.value = color;
    hex.value = color;
  }
  byId<HTMLInputElement>("design-ui-scale").value = String(designTheme.uiScale);
  byId("design-ui-scale-value").textContent =
    `${Math.round(designTheme.uiScale * 100)}%`;
  byId<HTMLInputElement>("design-radius").value = String(designTheme.radius);
  byId("design-radius-value").textContent = `${designTheme.radius}px`;
  byId<HTMLInputElement>("design-space").value = String(designTheme.space);
  byId("design-space-value").textContent =
    `${Math.round(designTheme.space * 100)}%`;
  byId<HTMLInputElement>("design-control-height").value = String(
    designTheme.controlHeight,
  );
  byId("design-control-height-value").textContent =
    `${designTheme.controlHeight}px`;
  pixelFontToggle.setAttribute(
    "aria-checked",
    String(designTheme.font === "pixel"),
  );
  designDialog.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
    btn.setAttribute(
      "aria-pressed",
      String(btn.dataset.preset === designTheme.presetId),
    );
  });
}

designOpen.addEventListener("click", () => {
  setDebugOpen(false);
  syncDesignControls();
  designDialog.showModal();
  designDialog.querySelector<HTMLElement>(".close")?.focus();
});
designDialog.querySelector<HTMLButtonElement>(".close")?.addEventListener(
  "click",
  () => designDialog.close(),
);
designDialog.addEventListener("click", (event) => {
  if (event.target === designDialog) designDialog.close();
});

designDialog.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.preset;
    if (!id || id === "custom") return;
    commitTheme(
      getPresetTheme(id as Exclude<DesignTheme["presetId"], "custom">),
    );
  });
});

byId("design-reset").addEventListener("click", () => {
  commitTheme({ ...DEFAULT_DESIGN_THEME });
});

for (const { key, id } of colorFields) {
  byId<HTMLInputElement>(id).addEventListener("input", (event) => {
    const value = (event.target as HTMLInputElement).value;
    commitTheme({ ...designTheme, [key]: value, presetId: "custom" });
  });
  byId<HTMLInputElement>(`${id}-hex`).addEventListener("change", (event) => {
    let value = (event.target as HTMLInputElement).value.trim();
    if (!value.startsWith("#")) value = `#${value}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
      (event.target as HTMLInputElement).value = designTheme[key];
      return;
    }
    commitTheme({
      ...designTheme,
      [key]: value.toLowerCase(),
      presetId: "custom",
    });
  });
}

byId<HTMLInputElement>("design-ui-scale").addEventListener("input", (event) => {
  const uiScale = Number((event.target as HTMLInputElement).value);
  commitTheme({ ...designTheme, uiScale, presetId: "custom" });
});
byId<HTMLInputElement>("design-radius").addEventListener("input", (event) => {
  const radius = Number((event.target as HTMLInputElement).value);
  commitTheme({ ...designTheme, radius, presetId: "custom" });
});
byId<HTMLInputElement>("design-space").addEventListener("input", (event) => {
  const space = Number((event.target as HTMLInputElement).value);
  commitTheme({ ...designTheme, space, presetId: "custom" });
});
byId<HTMLInputElement>("design-control-height").addEventListener(
  "input",
  (event) => {
    const controlHeight = Number((event.target as HTMLInputElement).value);
    commitTheme({ ...designTheme, controlHeight, presetId: "custom" });
  },
);
pixelFontToggle.addEventListener("click", () => {
  const font = designTheme.font === "pixel" ? "system" : "pixel";
  commitTheme({ ...designTheme, font, presetId: "custom" });
});

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    log("Copied text to clipboard");
  } catch {
    lastError = "Clipboard access was denied.";
    log(lastError);
  }
}

function renderDebug() {
  const age = table
    ? `${Math.floor((Date.now() - table.fetchedAt) / 1000)} seconds`
    : "Not available";
  const rows = [
    ["App version", "1.0.0"],
    ["Shell", isTauri ? "Tauri desktop" : "Browser"],
    ["Connection", navigator.onLine ? "Online" : "Offline"],
    ["Provider", table?.provider ?? "Coinbase"],
    ["Current base", from?.value ?? prefs.from],
    ["Valid rates", String(table ? Object.keys(table.rates).length : 0)],
    [
      "Last fetch",
      table ? new Date(table.fetchedAt).toLocaleString() : "Never",
    ],
    ["Cache age", age],
    ...(isTauri
      ? []
      : ([
          [
            "Service worker",
            navigator.serviceWorker?.controller ? "Active" : "Not controlling",
          ],
          [
            "PWA install",
            matchMedia("(display-mode: standalone)").matches
              ? "Installed"
              : deferredInstall
                ? "Available"
                : "Browser controlled",
          ],
        ] as [string, string][])),
    [
      "Request duration",
      requestDuration === null ? "Not available" : `${requestDuration} ms`,
    ],
    ["Latest error", lastError],
  ];
  const node = byId("debug-content");
  if (node)
    node.innerHTML = `<dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  const session = byId("session-log");
  if (session)
    session.textContent = logs.join("\n") || "No session events yet.";
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
  if (
    document.visibilityState === "visible" &&
    table &&
    !isFresh(table.fetchedAt)
  )
    void loadRates();
});

if (!isTauri) {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event as BeforeInstallPromptEvent;
    byId("install-app").hidden = false;
    renderDebug();
  });
  byId("install-app").addEventListener(
    "click",
    () => void deferredInstall?.prompt(),
  );

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
renderDebug();
void loadRates();
