# Deez Currency Calculator

A compact fiat and cryptocurrency converter with a black pixel-art identity. It uses Coinbase's public exchange-rate endpoint, exact decimal arithmetic, cached last-known rates, and no login, analytics, advertising, cookies, API keys, or backend.

Ships as a **Tauri desktop app** (native window, not a browser tab). The Vite frontend remains portable for development and tests.

## One-click setup and run

**Requirements:** Node.js 20+, [pnpm](https://pnpm.io), and [Rust](https://rustup.rs) (for Tauri).

| Platform | Launcher |
|----------|----------|
| macOS | Double-click **`run.command`** |
| Windows | Double-click **`run.bat`** |

Both install JS deps if needed, then start `pnpm tauri:dev` and open the native app window.

## Development

```text
pnpm install
pnpm tauri:dev          # desktop app (Vite on http://localhost:5181)
pnpm dev                # UI only in a browser (iteration / debugging)
pnpm test
pnpm lint
pnpm format:check
pnpm build
pnpm tauri:build        # packaged .app / DMG / NSIS / MSI
pnpm test:e2e
```

Sticky Vite port for Tauri/dev: **5181** (`strictPort`). Preview/e2e uses **4173**.

Production frontend output is `dist/` (consumed by Tauri as `frontendDist`).

## Behaviour and assumptions

- First launch defaults to 1 ZAR → USD; valid amount and pair choices are restored locally.
- Coinbase rates are indicative only. Banks, card providers and exchanges may use different rates or add fees.
- Rate tables under two minutes old are fresh. Older cached tables remain usable and are clearly marked stale or offline.
- Coinbase has no dedicated currency-catalogue endpoint in this app, so the UI uses a curated catalogue of major fiat and crypto currencies and validates actual target availability against each returned table.
- In the desktop shell, PWA install / service-worker update prompts are disabled (native packaging replaces them). Browser/`pnpm dev` still supports the PWA path for optional web use.
- The tip screen uses labeled BTC and USDC QR codes in `public/qr/` (configured in `src/config/tips.ts`).
- Pixel UI: Press Start 2P, money-bag brand, inline DEBUG LOG, and tip sprites under `public/sprites/`.
- App icons follow the black-plate / white-glyph mark used for installers and in-app chrome.

## Project map

- `src/api/` — provider abstraction, timeout/retry behaviour, response validation
- `src/conversion/` — independent input parsing, exact calculation, display formatting
- `src/storage/` — preferences and IndexedDB rate cache
- `src/main.ts` — accessible UI and application state orchestration
- `src-tauri/` — Tauri 2 desktop shell (window, CSP, bundling)
- `tests/unit/` and `tests/e2e/` — Vitest and Playwright coverage
