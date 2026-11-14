// App icon: pixel-art coins (a silver euro tucked behind a gold dollar) on the app's navy, matching the
// 8-bit UI (gold #ffd23f, navy #16162a, dot grid).
// Usage: node scripts/app-icon.mjs
// Writes the SVG sources and every PNG master to public/ and build/icon/, store/play/images/icon-512.png,
// then runs `tauri icon` for the desktop pack (src-tauri/icons) and the iOS/Android packs, and copies
// those into src-tauri/gen/apple and src-tauri/gen/android.
import { chromium } from "@playwright/test";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pub = join(root, "public");
const work = join(root, "build/icon");
mkdirSync(work, { recursive: true });
mkdirSync(join(pub, "icons"), { recursive: true });


// Pixel-art coin pair on a 32x32 grid (32px cells on a 1024 canvas).
const C = 32;
const BITMAPS = {
  $: [
    "...#...",
    ".#####.",
    "##.#.##",
    "##.#...",
    ".#####.",
    "...#.##",
    "##.#.##",
    ".#####.",
    "...#...",
  ],
  "€": [
    "..#####",
    ".##...#",
    "######.",
    ".##....",
    "######.",
    ".##....",
    ".##...#",
    "..#####",
  ],
};
const rect = (x, y, fill, w = 1, h = 1) =>
  `<rect x="${x * C}" y="${y * C}" width="${w * C}" height="${h * C}" fill="${fill}"/>`;

function coin(cx, cy, r, pal, glyph, gdx = 0, gdy = 0) {
  const cells = new Map();
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      if (d > r) continue;
      let f = pal.face;
      if (d > r - 1.15) f = dx + dy > 0 ? pal.rimDark : pal.rim;
      else if (d > r - 2.15) f = dx + dy < 0 ? pal.hi : pal.shade;
      cells.set(`${x},${y}`, f);
    }
  // glyph with 1-cell emboss shadow
  const bm = BITMAPS[glyph];
  const gw = bm[0].length, gh = bm.length;
  const gx = Math.round(cx - gw / 2 + gdx), gy = Math.round(cy - gh / 2 + gdy);
  bm.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch !== "#") return;
    const s = `${gx + i + 1},${gy + j + 1}`;
    void s;
  }));
  bm.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === "#") cells.set(`${gx + i},${gy + j}`, pal.ink); }));
  return cells;
}

function art() {
  const ink = "#16162a";
  const silver = { face: "#e4e2ef", hi: "#ffffff", shade: "#b9b7d2", rim: "#a3a1c2", rimDark: "#6f6d94", ink, emboss: "#a3a1c2" };
  const gold = { face: "#ffd23f", hi: "#fff3b0", shade: "#ffb43f", rim: "#f0a020", rimDark: "#b86a10", ink, emboss: "#e09a1a" };
  const back = coin(10.5, 10.5, 7.5, silver, "€", -0.5, -0.5);
  const front = coin(20, 20, 8.5, gold, "$");
  const out = [];
  // back coin, then a dark gap ring + drop shadow for the front coin, then the front coin
  for (const [k, f] of back) { const [x, y] = k.split(",").map(Number); out.push(rect(x, y, f)); }
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.hypot(x + 0.5 - 20, y + 0.5 - 20), ds = Math.hypot(x + 0.5 - 21, y + 0.5 - 21);
    if ((d <= 9.6 && back.has(`${x},${y}`)) ) out.push(rect(x, y, "#0b0b14"));
    else if (ds <= 8.5 && d > 8.5) out.push(rect(x, y, "#07070d"));
  }
  for (const [k, f] of front) { const [x, y] = k.split(",").map(Number); out.push(rect(x, y, f)); }
  out.push(rect(15, 14, "#ffffff"), rect(14, 15, "#ffffff"), rect(6, 6, "#ffffff"));
  // sparkles
  const spark = (x, y, c) => out.push(rect(x, y - 1, c), rect(x - 1, y, c), rect(x, y, "#ffffff"), rect(x + 1, y, c), rect(x, y + 1, c));
  spark(25, 7, "#ffd23f");
  out.push(rect(21, 4, "#ffd23f"), rect(28, 11, "#a3a1c2"));
  spark(6, 24, "#a3a1c2");
  return out.join("");
}

function plateFill() {
  // navy with a soft gold glow behind the coins and the app's dot grid
  let dots = "";
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) dots += `<rect x="${x * C + 14}" y="${y * C + 14}" width="4" height="4" fill="#ffffff" opacity="0.045"/>`;
  return dots;
}

const NAVY = "#16162a";
// Plate: the app's navy with a soft lift behind the coins and its faint dot grid.
const plate = () =>
  `<defs><radialGradient id="glow" cx="0.55" cy="0.55" r="0.6"><stop offset="0" stop-color="#2a2a48"/><stop offset="1" stop-color="#11111f"/></radialGradient></defs>` +
  `<rect width="1024" height="1024" fill="url(#glow)"/>${plateFill()}`;

const svg = (_body, { plate: kind = "square", inset = 0 } = {}) => {
  const k = inset ? `<g transform="translate(${512 * inset} ${512 * inset}) scale(${1 - inset})">${art()}</g>` : art();
  const bg =
    kind === "squircle"
      ? `<clipPath id="sq"><rect width="1024" height="1024" rx="230"/></clipPath><g clip-path="url(#sq)">${plate()}</g>` +
        `<rect x="1.5" y="1.5" width="1021" height="1021" rx="230" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="3"/>`
      : kind === "square"
        ? plate()
        : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" shape-rendering="crispEdges">${bg}${k}</svg>`;
};

// Masters
const masters = {
  // Dock / PWA / Tauri desktop: squircle, transparent corners, hairline rim.
  "desktop-1024": svg(null, { plate: "squircle" }),
  // iOS / Play / Android: full-bleed opaque square (the OS applies its own mask).
  "full-1024": svg(null, { plate: "square" }),
  // Maskable / adaptive: coins kept inside the 80% safe zone.
  "maskable-1024": svg(null, { plate: "square", inset: 0.14 }),
  // Android adaptive foreground: transparent, coins inside the 66% safe zone.
  "foreground-1024": svg(null, { plate: "none", inset: 0.34 }),
  // Icon Composer layer: coins only, navy fill comes from icon.json.
  "composer-glyph-1024": svg(null, { plate: "none", inset: 0.06 }),
  // Android adaptive background: the plate alone.
  "background-1024": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${plate()}</svg>`,
};

writeFileSync(join(pub, "icon.svg"), masters["desktop-1024"]);
writeFileSync(
  join(pub, "glyph.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="64 64 896 896" width="24" height="24" shape-rendering="crispEdges">${art()}</svg>`,
);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });

async function render(svgText, size, opaque) {
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style></head><body>${svgText}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.evaluate(
    async ({ size, opaque, navy }) => {
      const el = document.querySelector("svg");
            const img = new Image();
      img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(el.outerHTML)));
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      if (opaque) {
        ctx.fillStyle = navy;
        ctx.fillRect(0, 0, size, size);
      }
      ctx.drawImage(img, 0, 0, size, size);
      return c.toDataURL("image/png").split(",")[1];
    },
    { size, opaque, navy: NAVY },
  );
  return Buffer.from(png, "base64");
}

for (const [name, s] of Object.entries(masters)) {
  writeFileSync(join(work, `${name}.png`), await render(s, 1024, ["full-1024", "maskable-1024", "background-1024"].includes(name)));
}

const out = [
  ["icon-1024.png", "desktop-1024", 1024],
  ["icon-512.png", "desktop-1024", 512],
  ["icon-192.png", "desktop-1024", 192],
  ["icons/icon-512.png", "desktop-1024", 512],
  ["icons/icon-192.png", "desktop-1024", 192],
  ["icon-512-maskable.png", "maskable-1024", 512],
  ["icon-192-maskable.png", "maskable-1024", 192],
  ["icons/icon-512-maskable.png", "maskable-1024", 512],
  ["icons/icon-192-maskable.png", "maskable-1024", 192],
  ["apple-touch-icon.png", "full-1024", 180],
  ["favicon-48.png", "desktop-1024", 48],
  ["favicon-32.png", "desktop-1024", 32],
  ["favicon-16.png", "desktop-1024", 16],
];
for (const [file, m, size] of out) {
  writeFileSync(join(pub, file), await render(masters[m], size, m !== "desktop-1024"));
}
mkdirSync(join(root, "store/play/images"), { recursive: true });
writeFileSync(join(root, "store/play/images/icon-512.png"), await render(masters["full-1024"], 512, true));
writeFileSync(join(pub, "macos-icon/AppIcon.icon/Assets/glyph.png"), readFileSync(join(work, "composer-glyph-1024.png")));

await browser.close();

// Native packs.
const tauri = (...args) => execFileSync("pnpm", ["exec", "tauri", "icon", ...args], { cwd: root, stdio: "inherit" });
tauri(join(work, "desktop-1024.png"), "-o", join(root, "src-tauri/icons"));
const mobile = join(work, "mobile-pack");
rmSync(mobile, { recursive: true, force: true });
writeFileSync(
  join(work, "mobile.json"),
  JSON.stringify({ default: "full-1024.png", bg_color: NAVY, android_bg: "background-1024.png", android_fg: "foreground-1024.png", android_fg_scale: 100 }),
);
tauri(join(work, "mobile.json"), "-o", mobile);
for (const d of ["ios", "android"]) cpSync(join(mobile, d), join(root, "src-tauri/icons", d), { recursive: true });
const appiconset = join(root, "src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset");
for (const f of readdirSync(join(mobile, "ios"))) cpSync(join(mobile, "ios", f), join(appiconset, f));
cpSync(join(mobile, "android"), join(root, "src-tauri/gen/android/app/src/main/res"), { recursive: true });
// `tauri icon` also writes a white ic_launcher_background colour (here and straight into gen/android); the adaptive
// icon uses the mipmap background instead, so drop it.
for (const d of ["src-tauri/icons/android/values", "src-tauri/gen/android/app/src/main/res/values/ic_launcher_background.xml"])
  rmSync(join(root, d), { recursive: true, force: true });
console.log("wrote public/ icons, build/icon/ masters and native icon packs");
