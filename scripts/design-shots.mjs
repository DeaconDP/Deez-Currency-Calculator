// Design review screenshots: every screen at iPhone sizes, rates mocked.
// Usage: TAURI_ENV_PLATFORM=ios pnpm dev --port 5199 &  node scripts/design-shots.mjs <outDir> [baseUrl]
import { chromium, webkit } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "design-shots";
const base = process.argv[3] ?? "http://127.0.0.1:5199/";
mkdirSync(out, { recursive: true });

const rates = {
  data: {
    currency: "ZAR",
    rates: { USD: "0.0558", ZAR: "1", EUR: "0.051", GBP: "0.0441", JPY: "8.62", BTC: "0.00000058", ETH: "0.0000171" },
  },
};

const devices = [
  { name: "iphone13promax", width: 428, height: 926, scale: 3 },
  { name: "iphoneSE", width: 375, height: 667, scale: 2 },
];

const engine = process.env.SHOTS_ENGINE === "chromium" ? chromium : webkit;
const browser = await engine.launch();
for (const d of devices) {
  const context = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.scale,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  });
  await context.addInitScript(() => localStorage.clear());
  const page = await context.newPage();
  let fail = false;
  await page.route("https://api.coinbase.com/**", (route) =>
    fail ? route.abort() : route.fulfill({ json: rates }),
  );
  const shot = async (state) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(out, `${d.name}-${state}.png`) });
  };
  const fresh = async () => {
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector("#result")?.value);
  };

  await fresh();
  await shot("01-main");
  if (d.name !== "iphone13promax") continue;

  await page.locator("#amount").fill("1250.5");
  await page.locator("#amount").blur();
  await shot("02-typed");

  await page.locator("#amount").focus();
  await shot("03-input-focused");
  await page.locator("#amount").blur();

  await page.locator("#swap").click();
  await shot("04-after-swap");

  await fresh();
  await page.locator("#from-trigger").click();
  await shot("05-currency-picker");
  await page.locator("#currency-search").fill("do");
  await shot("06-currency-picker-search");
  await page.keyboard.press("Escape");

  await page.locator("#design-open").click();
  await shot("07-settings");
  await page.keyboard.press("Escape");

  await page.locator("#design-open").click();
  await page.locator("#debug-open").click();
  await shot("08-diagnostics");
  await page.keyboard.press("Escape");

  await page.locator("#design-open").click();
  await page.locator('[data-preset="soft"]').click();
  await page.keyboard.press("Escape");
  await shot("08b-gameboy-look");
  await page.locator("#design-open").click();
  await page.locator('[data-preset="neon"]').click();
  await page.keyboard.press("Escape");
  await shot("08c-arcade-look");
  await page.locator("#design-open").click();
  await page.locator('[data-preset="high-contrast"]').click();
  await page.keyboard.press("Escape");
  await shot("08d-contrast-look");
  await page.locator("#design-open").click();
  await page.locator('[data-preset="default"]').click();
  await page.keyboard.press("Escape");

  await page.locator("#to-trigger").click();
  await page.locator('#currency-picker .currency-option[data-code="EUR"]').click();
  await page.locator("#to-trigger").click();
  await page.locator('#currency-picker .currency-option[data-code="BTC"]').click();
  await page.locator("#to-trigger").click();
  await shot("05b-picker-recents");
  await page.keyboard.press("Escape");
  await page.locator("#amount").fill("500");
  await page.locator("#amount").blur();
  await shot("05c-btc-pair");
  await page.locator("#to-trigger").click();
  await page.locator('#currency-picker .currency-option[data-code="USD"]').click();

  await page.locator("#design-open").click();
  await page.locator("#large-text").click();
  await shot("07b-settings-large-text");
  await page.keyboard.press("Escape");
  await shot("07c-main-large-text");
  await page.locator("#design-open").click();
  await page.locator("#large-text").click();
  await page.keyboard.press("Escape");

  await page.locator("#amount").fill("1234567890123456789");
  await shot("09-too-long-input");

  fail = true;
  await page.evaluate(() => indexedDB.databases?.().then((dbs) => dbs.forEach((db) => indexedDB.deleteDatabase(db.name))));
  await page.goto(base);
  await page.waitForTimeout(1500);
  await shot("10-rates-error");
  await context.close();
}
await browser.close();
console.log(`shots in ${out}`);
