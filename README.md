# Deac's Currency Converter

A compact, installable fiat and cryptocurrency converter with a black pixel-art identity. It uses Coinbase's public exchange-rate endpoint, exact decimal arithmetic, cached last-known rates, and no login, analytics, advertising, cookies, API keys, or backend.

## One-click setup and run (Windows)

Double-click **`Launch Deac Currency Converter.vbs`**. It starts the included production build in the default browser without showing a terminal and without requiring Node.js. Leave the project folder in place while using it. Opening the launcher again focuses a new browser tab without starting a duplicate server.

The launcher serves only on `localhost`; it does not expose the app to the network. Windows PowerShell may ask for a firewall decision on some systems—private and public network access can both remain denied because only local access is needed.

## Development

Developers can use Node.js 20+ and pnpm:

```text
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm format:check
pnpm build
pnpm test:e2e
```

The production output is `dist/`. Keep it committed or packaged alongside the launcher to preserve the dependency-free one-click path. Deploy `dist/` to any HTTPS static host. Set the supplied Content Security Policy as an HTTP header where possible; the app also includes the equivalent meta policy.

## Behaviour and assumptions

- First visit defaults to 1 ZAR → USD; valid amount and pair choices are restored locally.
- Coinbase rates are indicative only. Banks, card providers and exchanges may use different rates or add fees.
- Rate tables under two minutes old are fresh. Older cached tables remain usable and are clearly marked stale or offline.
- Coinbase has no dedicated currency-catalogue endpoint in this app, so the UI uses a curated catalogue of major fiat and crypto currencies and validates actual target availability against each returned table.
- Browsers govern PWA installation. When available, Install appears in Debug; deployment must use HTTPS (localhost is treated as secure).
- The donation panel uses the BTC and USDC QR codes in `public/qr/donations.jpeg`.
- The app uses the supplied interlocking-coin artwork for its favicon, Apple touch icon, header mark, standard PWA icons, and maskable PWA icons.
- Windows' built-in local server stays running until sign-out or until its hidden PowerShell process ends. This is intentional so the installed/local PWA remains available.

## Project map

- `src/api/` — provider abstraction, timeout/retry behaviour, response validation
- `src/conversion/` — independent input parsing, exact calculation, display formatting
- `src/storage/` — preferences and IndexedDB rate cache
- `src/main.ts` — accessible UI and application state orchestration
- `scripts/serve.ps1` — dependency-free local production server used by the launcher
- `tests/unit/` and `tests/e2e/` — Vitest and Playwright coverage
