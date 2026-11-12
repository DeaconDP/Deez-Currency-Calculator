// Google Play graphics: 512x512 app icon (32-bit PNG) and 1024x500 feature graphic (JPEG, no alpha).
// Usage: node scripts/play-graphics.mjs [outDir]   (default store/play/images)
// Renders with Playwright (Chromium) from files in public/, so no dev server is needed.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(process.argv[2] ?? join(root, "store/play/images"));
mkdirSync(outDir, { recursive: true });

const dataUrl = (rel, mime) => `data:${mime};base64,${readFileSync(join(root, rel)).toString("base64")}`;
const icon = dataUrl("public/icon-1024.png", "image/png");
const font = dataUrl("public/fonts/PressStart2P-Regular.ttf", "font/ttf");
const mark = dataUrl("public/sprites/btc-chart.png", "image/png");

const browser = await chromium.launch();

// --- icon: Play masks corners itself, so fill the source icon's transparent rounded corners with its own
// background colour (sampled from the centre-left edge) and export a full-bleed square.
{
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0"><canvas id="c" width="512" height="512"></canvas></body></html>`);
  const png = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const probe = new OffscreenCanvas(1024, 1024).getContext("2d");
    probe.drawImage(img, 0, 0);
    const [r, g, b] = probe.getImageData(40, 512, 1, 1).data;
    const canvas = document.getElementById("c");
    const ctx = canvas.getContext("2d");
    // Keep only the bright glyph: the source's rounded-rect edge stroke would otherwise show as a faint
    // ring inside Play's own mask.
    const glyph = new OffscreenCanvas(512, 512).getContext("2d");
    glyph.imageSmoothingQuality = "high";
    glyph.drawImage(img, 0, 0, 512, 512);
    const px = glyph.getImageData(0, 0, 512, 512);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      // brightness as composited over the background (the edge stroke is bright but mostly transparent)
      const v = r + (Math.max(d[i], d[i + 1], d[i + 2]) - r) * (d[i + 3] / 255);
      const t = v > 110 ? (v - r) / (255 - r) : 0;
      d[i] = r + (255 - r) * t;
      d[i + 1] = g + (255 - g) * t;
      d[i + 2] = b + (255 - b) * t;
      d[i + 3] = 255;
    }
    ctx.putImageData(px, 0, 0);
    // canvas PNG export keeps the alpha channel (RGBA, Play's "32-bit PNG"); a page screenshot drops it.
    return canvas.toDataURL("image/png").split(",")[1];
  }, icon);
  writeFileSync(join(outDir, "icon-512.png"), Buffer.from(png, "base64"));
  await page.close();
}

// --- feature graphic
{
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: "PS2P"; src: url(${font}) format("truetype"); }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1024px; height: 500px; overflow: hidden; }
    body {
      background-color: #0b0b14;
      background-image: radial-gradient(#1c1c2e 1.5px, transparent 1.6px);
      background-size: 16px 16px;
      font-family: "PS2P", monospace; color: #e8e8f0;
      -webkit-font-smoothing: none; font-smooth: never;
      display: flex; align-items: center; gap: 56px; padding: 0 64px;
    }
    .left { display: flex; flex-direction: column; gap: 22px; width: 520px; }
    .brand { display: flex; align-items: center; gap: 20px; }
    .mark { width: 72px; height: 72px; background: #ffd23f; image-rendering: pixelated;
      -webkit-mask: url(${mark}) center / 72px 72px no-repeat; mask: url(${mark}) center / 72px 72px no-repeat;
      filter: drop-shadow(4px 4px 0 #000); }
    h1 { margin: 0; font-size: 56px; line-height: 1; color: #ffd23f; text-shadow: 5px 5px 0 #000; font-weight: normal; }
    .sub { font-size: 24px; line-height: 1.5; color: #e8e8f0; text-shadow: 3px 3px 0 #000; }
    .tags { font-size: 14px; line-height: 2; color: #9a9ab8; letter-spacing: 1px; }
    .tags b { color: #ffd23f; font-weight: normal; }
    .card { width: 320px; background: #1a1a2e; border: 4px solid #2c2c48; box-shadow: 8px 8px 0 #000; padding: 22px; }
    .label { font-size: 11px; color: #9a9ab8; margin-bottom: 10px; }
    .label b { color: #ffd23f; font-weight: normal; }
    .row { display: flex; gap: 10px; margin-bottom: 20px; }
    .well { flex: 1; background: #10101c; border: 3px solid #26263c; padding: 14px 12px; text-align: right; font-size: 24px; }
    .gold { color: #ffd23f; }
    .cur { width: 84px; background: #2c2c48; border: 3px solid #000; display: grid; place-items: center; font-size: 16px; }
    .swap { width: 44px; height: 44px; margin: 0 auto 18px; background: #ffd23f; color: #0b0b14; border: 3px solid #000;
      display: grid; place-items: center; box-shadow: 4px 4px 0 #000; }
  </style></head><body>
    <div class="left">
      <div class="brand"><span class="mark"></span><h1>DEACS</h1></div>
      <div class="sub">CURRENCY<br>CONVERTER</div>
      <div class="tags">FIAT <b>+</b> CRYPTO <b>&middot;</b> LIVE RATES<br>NO ADS <b>&middot;</b> NO ACCOUNT</div>
    </div>
    <div class="card">
      <div class="label"><b>YOU TYPE</b> RAND</div>
      <div class="row"><div class="well">1,250</div><div class="cur">ZAR</div></div>
      <div class="swap"><svg width="24" height="24" viewBox="0 0 12 12" shape-rendering="crispEdges" fill="#0b0b14">
        <rect x="3" y="1" width="1" height="1"/><rect x="2" y="2" width="3" height="1"/><rect x="1" y="3" width="5" height="1"/>
        <rect x="3" y="4" width="1" height="7"/>
        <rect x="8" y="1" width="1" height="7"/><rect x="6" y="8" width="5" height="1"/><rect x="7" y="9" width="3" height="1"/>
        <rect x="8" y="10" width="1" height="1"/></svg></div>
      <div class="label"><b>YOU GET</b> US DOLLAR</div>
      <div class="row" style="margin-bottom:0"><div class="well gold">69.75</div><div class="cur">USD</div></div>
    </div>
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(outDir, "feature-graphic.jpg"), type: "jpeg", quality: 95 });
  await page.close();
}

await browser.close();
console.log(`play graphics in ${outDir}`);
