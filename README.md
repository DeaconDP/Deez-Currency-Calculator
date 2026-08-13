# Deez Currency Calculator

A compact fiat and cryptocurrency converter with a black pixel-art identity. It uses Coinbase's public exchange-rate endpoint, exact decimal arithmetic, cached last-known rates, and no login, analytics, advertising, cookies, API keys, or backend.

Ships as a **Tauri desktop app** (own little window) with the same UI also available as a **PWA** in the browser.

## One-click setup and run

**Requirements:** Node.js 20+, [pnpm](https://pnpm.io), [Rust/Cargo](https://rustup.rs) (for the first build), Xcode Command Line Tools on macOS.

| Platform | Launcher |
|----------|----------|
| macOS | Double-click **`run.command`** |
| Windows | Double-click **`run.bat`** |

Both install deps, rebuild the release app when missing or source is newer, then open the native window (**420×720**). They do **not** open a browser tab for normal use.

On macOS, `run.command` shows a small loading splash while it works, then opens:

`src-tauri/target/release/bundle/macos/Deez Currency Calculator.app`

Optional Desktop shortcut:

```text
./run.command --shortcut   # macOS
run.bat --shortcut         # Windows
```

Force a rebuild: `./run.command --rebuild` / `run.bat --rebuild`.

## Development

```text
pnpm install
pnpm tauri:dev          # desktop window (use this — not a browser tab on :5181)
pnpm dev                # browser-only Vite at http://127.0.0.1:5181
pnpm test
pnpm lint
pnpm format:check
pnpm build
pnpm tauri:build
pnpm test:e2e
```

Sticky Vite port: **5181** (`strictPort`, `127.0.0.1`). Preview/e2e uses **4173**. Launch splash UI uses **5191**.

Production frontend output is `dist/` (also bundled into the Tauri app). PWA install and service worker apply in the browser path only.

## Behaviour and assumptions

- First launch defaults to 1 ZAR → USD; valid amount and pair choices are restored locally.
- Coinbase rates are indicative only. Banks, card providers and exchanges may use different rates or add fees.
- Rate tables under two minutes old are fresh. Older cached tables remain usable and are clearly marked stale or offline.
- Coinbase has no dedicated currency-catalogue endpoint in this app, so the UI uses a curated catalogue of major fiat and crypto currencies and validates actual target availability against each returned table.
- Desktop shell is window-only (no native IPC). Browser PWA install / update prompts remain available when you open the Vite URL.
- The tip screen uses labeled BTC and USDC QR codes in `public/qr/` (configured in `src/config/tips.ts`).
- Pixel UI: Press Start 2P, money-bag brand, inline DEBUG LOG, and tip sprites under `public/sprites/`.
- App icons follow the black-plate / white-glyph mark used for installers and in-app chrome.

## Project map

- `src/api/` — provider abstraction, timeout/retry behaviour, response validation
- `src/conversion/` — independent input parsing, exact calculation, display formatting
- `src/storage/` — preferences and IndexedDB rate cache
- `src/main.ts` — accessible UI and application state orchestration
- `src-tauri/` — Tauri 2 desktop shell (compact window)
- `scripts/` — Project Manager–style release launch (loading UI → rebuild → open)
- `tests/unit/` and `tests/e2e/` — Vitest and Playwright coverage
