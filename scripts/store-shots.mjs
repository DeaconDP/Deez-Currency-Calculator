// Store screenshots at the exact store sizes (WebKit, mobile build flags).
// App Store: TAURI_ENV_PLATFORM=ios pnpm dev --port 5199 --strictPort &
//            node scripts/store-shots.mjs [outRoot] [baseUrl]
//   Writes <outRoot>/iphone-6.9/*.jpg (1320x2868) and <outRoot>/ipad-13/*.jpg (2048x2732).
// Google Play: TAURI_ENV_PLATFORM=android pnpm dev --port 5199 --strictPort &
//            node scripts/store-shots.mjs store/play/images http://127.0.0.1:5199/ play
//   Writes <outRoot>/phone/*.jpg (1080x2160, exactly Play's 2:1 max; JPEG so no alpha).
import { webkit } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outRoot = process.argv[2] ?? "store/screenshots/en-US";
const base = process.argv[3] ?? "http://127.0.0.1:5199/";

const ratesByBase = {
  ZAR: { USD: "0.0558", EUR: "0.0511", GBP: "0.0441", JPY: "8.62", ZAR: "1", BTC: "0.00000058", ETH: "0.0000171" },
};

const deviceSets = {
  appstore: [
    { dir: "iphone-6.9", prefix: "iphone", width: 440, height: 956, scale: 3, mobile: true },
    { dir: "ipad-13", prefix: "ipad", width: 1024, height: 1366, scale: 2, mobile: false },
  ],
  play: [{ dir: "phone", prefix: "phone", width: 360, height: 720, scale: 3, mobile: true, extra: true }],
};
const set = process.argv[4] ?? "appstore";
const devices = deviceSets[set];
if (!devices) throw new Error(`unknown device set ${set}; use ${Object.keys(deviceSets).join(" or ")}`);

const browser = await webkit.launch();
for (const d of devices) {
  const out = join(outRoot, d.dir);
  mkdirSync(out, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.scale,
    isMobile: d.mobile,
    hasTouch: true,
    colorScheme: "dark",
    locale: "en-US",
  });
  await context.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("deac-currency-pairs-v1", JSON.stringify(["ZAR>USD", "ZAR>EUR", "ZAR>BTC", "ZAR>GBP"]));
    localStorage.setItem("deac-currency-recents-v1", JSON.stringify(["EUR", "BTC", "GBP"]));
  });
  const page = await context.newPage();
  await page.route("https://api.coinbase.com/**", (route) => {
    const cur = new URL(route.request().url()).searchParams.get("currency") ?? "ZAR";
    route.fulfill({ json: { data: { currency: cur, rates: ratesByBase[cur] ?? ratesByBase.ZAR } } });
  });
  const shot = async (name) => {
    await page.waitForTimeout(600); // let tally/ping animations settle
    // JPEG: App Store screenshots must not have an alpha channel
    await page.screenshot({ path: join(out, `${d.prefix}-${name}.jpg`), type: "jpeg", quality: 100 });
  };
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector("#result")?.value);

  // 1. everyday conversion
  await page.locator("#amount").fill("1250");
  await page.locator("#amount").blur();
  await shot("01-convert");

  // 2. bitcoin in sats
  await page.locator(".pair-chip", { hasText: "BTC" }).click();
  await page.locator("#amount").fill("500");
  await page.locator("#amount").blur();
  await shot("02-sats");

  // 3. picker with search
  await page.locator(".pair-chip", { hasText: "USD" }).click();
  await page.locator("#to-trigger").click();
  await page.locator("#currency-search").fill("do");
  await page.locator("#currency-search").blur();
  await shot("03-picker");
  await page.keyboard.press("Escape");

  // 4. looks
  await page.locator("#design-open").click();
  await page.locator('[data-preset="soft"]').click();
  await shot("04-looks");
  if (d.extra) {
    // 5. the Arcade look on the main screen
    await page.locator('[data-preset="neon"]').click();
    await page.keyboard.press("Escape");
    await shot("05-arcade");
    await page.locator("#design-open").click();
  }
  await page.locator('[data-preset="default"]').click();
  await page.keyboard.press("Escape");

  await context.close();
}
await browser.close();
console.log(`store screenshots in ${outRoot}`);
