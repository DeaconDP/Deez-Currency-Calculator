import "./styles.css";
import Big from "big.js";
import { registerSW } from "virtual:pwa-register";
import { CoinbaseProvider } from "./api/coinbase";
import { calculate } from "./conversion/calculate";
import { formatRate, formatResult } from "./conversion/format";
import { parseAmount } from "./conversion/parseAmount";
import { currencies, getCurrency } from "./data/currencies";
import {
  clearRateCache,
  getCachedRates,
  isFresh,
  loadPreferences,
  savePreferences,
  setCachedRates,
} from "./storage/storage";
import type { AppStatus, RateTable } from "./types";

const provider = new CoinbaseProvider();
const prefs = loadPreferences();
let table: RateTable | null = null;
let status: AppStatus = "loading";
let lastError = "None";
let requestDuration: number | null = null;
let abortController: AbortController | null = null;
let deferredInstall: BeforeInstallPromptEvent | null = null;
const logs: string[] = [];
const themeKey = "deac-currency-theme";
const themes = ["wall-street", "wolf", "big-short", "margin-call"];
const storedTheme = localStorage.getItem(themeKey);
const savedTheme =
  storedTheme && themes.includes(storedTheme) ? storedTheme : "wall-street";

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
  }
}

const app = document.querySelector<HTMLDivElement>("#app")!;
const options = (selected: string) =>
  ["fiat", "crypto"]
    .map(
      (type) =>
        `<optgroup label="${type === "fiat" ? "Fiat currencies" : "Cryptocurrencies"}">${currencies
          .filter((c) => c.type === type)
          .map(
            (c) =>
              `<option value="${c.code}" ${c.code === selected ? "selected" : ""}>${c.code} – ${c.name}</option>`,
          )
          .join("")}</optgroup>`,
    )
    .join("");

app.innerHTML = `
  <main class="shell">
    <header class="brand" aria-label="Deac's Currency Converter"><h1><span>DEAC'S</span><span>CURRENCY</span><span>CONVERTER</span></h1><img src="/icons/icon-192.png" alt="" width="58" height="58"></header>
    <div class="theme-picker"><label for="theme">Feature presentation</label><select id="theme" aria-label="Colour theme"><option value="wall-street">Wall Street</option><option value="wolf">The Wolf of Wall Street</option><option value="big-short">The Big Short</option><option value="margin-call">Margin Call</option></select></div>
    <section class="converter" aria-labelledby="converter-title">
      <h2 id="converter-title" class="sr-only">Currency converter</h2>
      <div class="conversion-grid">
        <div class="field"><label for="amount">Amount</label><input id="amount" inputmode="decimal" autocomplete="off" value="${prefs.amount}" aria-describedby="amount-error"><span id="amount-error" class="error"></span></div>
        <div class="field result-field"><label for="result">Converted amount</label><input id="result" readonly aria-live="polite" value="—"><button id="copy-result" class="inline-button" aria-label="Copy converted amount" title="Copy result">⧉</button></div>
        <div class="field"><label for="from">From</label><select id="from">${options(prefs.from)}</select></div>
        <button id="swap" class="swap" aria-label="Swap ${prefs.from} and ${prefs.to}" title="Swap currencies">⇄</button>
        <div class="field"><label for="to">To</label><select id="to">${options(prefs.to)}</select></div>
      </div>
      <div class="rate-block"><div id="direct-rate">Loading current rate…</div><div id="inverse-rate" class="muted"></div><div class="status-row"><span id="status" class="status">LOADING</span><button id="refresh" class="text-button">↻ Refresh</button></div></div>
      <p id="main-error" class="main-error" role="alert"></p>
      <p class="notice">Indicative market rates. Banks, card providers and exchanges may use different rates or add fees.</p>
    </section>
    <nav class="bottom-actions" aria-label="App actions"><button id="debug-open" class="action debug">▣ <span>DEBUG</span></button><button id="tip-open" class="action tip">♥ <span>TIP</span></button></nav>
    <footer class="site-credit">Built by <a href="https://deac.online" target="_blank" rel="noopener noreferrer">deac.online</a> at <a href="https://worldbuild.io" target="_blank" rel="noopener noreferrer">worldbuild.io</a></footer>
  </main>
  <dialog id="debug-dialog"><div class="dialog-head"><h2>Debug console</h2><button class="close" aria-label="Close debug panel">×</button></div><div id="debug-content"></div><div class="dialog-actions"><button id="debug-refresh">Refresh rates</button><button id="clear-cache">Clear cache</button><button id="copy-diagnostics">Copy diagnostics</button><button id="install-app" hidden>Install app</button></div><pre id="session-log"></pre></dialog>
  <dialog id="tip-dialog"><div class="dialog-head"><div><h2>Tip jar</h2><p class="muted">Scan a code to donate with BTC or USDC.</p></div><button class="close" aria-label="Close tip panel">×</button></div><img class="donation-qr" src="/qr/donations.jpeg" alt="Donation QR codes for BTC and USDC" width="950" height="558"></dialog>
  <aside id="update-toast" hidden>A new version is available. <button id="update-app">Update</button></aside>`;

const amount = byId<HTMLInputElement>("amount");
const result = byId<HTMLInputElement>("result");
const from = byId<HTMLSelectElement>("from");
const to = byId<HTMLSelectElement>("to");
const theme = byId<HTMLSelectElement>("theme");

theme.value = savedTheme;
document.documentElement.dataset.theme = theme.value;
theme.addEventListener("change", () => {
  document.documentElement.dataset.theme = theme.value;
  localStorage.setItem(themeKey, theme.value);
});

function byId<T extends HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
function log(message: string) {
  logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  if (logs.length > 100) logs.shift();
  renderDebug();
}
function save() {
  savePreferences({ amount: amount.value, from: from.value, to: to.value });
}

function renderConversion() {
  const parsed = parseAmount(amount.value);
  const target = getCurrency(to.value);
  const rate = table?.rates[to.value];
  byId("amount-error").textContent =
    amount.value && !parsed.valid ? parsed.reason : "";
  if (parsed.valid && rate && target) {
    const raw = calculate(amount.value, rate)!;
    result.value = formatResult(raw, target);
    byId("direct-rate").textContent =
      `1 ${from.value} = ${formatRate(rate)} ${to.value}`;
    byId("inverse-rate").textContent =
      `1 ${to.value} = ${formatRate(new Big(1).div(rate).toFixed())} ${from.value}`;
  } else {
    if (!amount.value) result.value = "";
    else if (!rate) result.value = "Unavailable";
    byId("direct-rate").textContent = rate
      ? "Enter a valid amount."
      : `No current rate is available for ${from.value} → ${to.value}.`;
    byId("inverse-rate").textContent = "";
  }
  renderStatus();
  save();
}

function renderStatus() {
  const element = byId("status");
  const age = table ? Date.now() - table.fetchedAt : 0;
  const time = table
    ? new Date(table.fetchedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  let text = "LOADING · Finding a saved rate";
  if (status === "refreshing")
    text = `REFRESHING · ${table ? `Showing rate saved at ${time}` : "Getting rates"}`;
  if (status === "fresh")
    text = `CURRENT · Updated ${age < 60_000 ? "just now" : `at ${time}`}`;
  if (status === "stale")
    text = `STALE · Last updated ${Math.max(2, Math.floor(age / 60_000))} minutes ago`;
  if (status === "offline")
    text = table
      ? `OFFLINE · Showing rate saved at ${time}`
      : "OFFLINE · No saved rate available";
  if (status === "error")
    text = table
      ? `STALE · Showing rate saved at ${time}`
      : "UNAVAILABLE · Try again";
  element.className = `status ${status}`;
  element.textContent = text;
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
  if (!navigator.onLine) {
    status = "offline";
    renderConversion();
    return;
  }
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
    status = table ? "stale" : "error";
    log(lastError);
  }
  renderConversion();
  renderDebug();
}

amount.addEventListener("input", renderConversion);
from.addEventListener("change", () => {
  table = null;
  save();
  void loadRates();
});
to.addEventListener("change", () => {
  renderConversion();
  if (!table?.rates[to.value]) void loadRates(true);
});
byId("refresh").addEventListener("click", () => void loadRates(true));
byId("swap").addEventListener("click", () => {
  const oldFrom = from.value;
  const converted = result.value.replace(/[^\d.,]/g, "");
  from.value = to.value;
  to.value = oldFrom;
  if (converted && converted !== "Unavailable") amount.value = converted;
  table = null;
  byId("swap").setAttribute("aria-label", `Swap ${from.value} and ${to.value}`);
  save();
  void loadRates();
});
byId("copy-result").addEventListener(
  "click",
  () => void copyText(result.value),
);

function openDialog(id: string) {
  const dialog = byId<HTMLDialogElement>(id);
  dialog.showModal();
  dialog.querySelector<HTMLElement>(".close")?.focus();
}
for (const [button, dialog] of [
  ["debug-open", "debug-dialog"],
  ["tip-open", "tip-dialog"],
])
  byId(button).addEventListener("click", () => openDialog(dialog));
document
  .querySelectorAll<HTMLButtonElement>("dialog .close")
  .forEach((button) =>
    button.addEventListener("click", () =>
      (button.closest("dialog") as HTMLDialogElement).close(),
    ),
  );
document.querySelectorAll<HTMLDialogElement>("dialog").forEach((dialog) =>
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }),
);
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
    ["Connection", navigator.onLine ? "Online" : "Offline"],
    ["Provider", table?.provider ?? "Coinbase"],
    ["Current base", from?.value ?? prefs.from],
    ["Valid rates", String(table ? Object.keys(table.rates).length : 0)],
    [
      "Last fetch",
      table ? new Date(table.fetchedAt).toLocaleString() : "Never",
    ],
    ["Cache age", age],
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
log("Application started");
renderDebug();
void loadRates();
