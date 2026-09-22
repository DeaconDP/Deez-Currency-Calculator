import { expect, test } from "@playwright/test";

const zarRates = {
  data: {
    currency: "ZAR",
    rates: {
      USD: "0.0558",
      ZAR: "1",
      EUR: "0.051",
      BTC: "0.000001",
    },
  },
};

async function mockCoinbase(page: import("@playwright/test").Page) {
  let requests = 0;
  await page.route("https://api.coinbase.com/**", async (route) => {
    requests += 1;
    await route.fulfill({ json: zarRates });
  });
  return {
    get requests() {
      return requests;
    },
  };
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.removeItem("deac-currency-preferences-v1");
  });
});

test("opens with the default pair and converts without refetching on input", async ({
  page,
}) => {
  const mock = await mockCoinbase(page);
  await page.goto("/");
  await expect(page.locator("#from")).toHaveValue("ZAR");
  await expect(page.locator("#to")).toHaveValue("USD");
  await expect(page.locator("#result")).toHaveValue(/0[.,]0558/);
  const before = mock.requests;
  await page.locator("#amount").fill("2");
  await expect(page.locator("#result")).toHaveValue(/0[.,]1116/);
  expect(mock.requests).toBe(before);
});

test("editing the bottom amount updates the top without refetching", async ({
  page,
}) => {
  const mock = await mockCoinbase(page);
  await page.goto("/");
  await expect(page.locator("#result")).toHaveValue(/0[.,]0558/);
  const before = mock.requests;
  await page.locator("#result").fill("1");
  await expect(page.locator("#amount")).toHaveValue(/17[.,]9211/);
  expect(mock.requests).toBe(before);
});

test("shows labeled BTC and USDC donation QR codes on the tip screen", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#tip-open").click();
  const tip = page.locator("#tip-dialog");
  await expect(tip).toBeVisible();
  await expect(tip.getByRole("heading", { name: /tip if/i })).toBeVisible();
  const btc = tip.getByAltText("Bitcoin donation QR code");
  const usdc = tip.getByAltText("USD Coin donation QR code");
  await expect(btc).toBeVisible();
  await expect(usdc).toBeVisible();
  await expect(btc).toHaveAttribute("src", "/qr/btc.png");
  await expect(usdc).toHaveAttribute("src", "/qr/usdc.png");
  await expect(tip.getByText("btc", { exact: true })).toBeVisible();
  await expect(tip.getByText("usdc", { exact: true })).toBeVisible();
});

test("toggles a debug log bottom sheet", async ({ page }) => {
  await page.goto("/");
  const panel = page.locator("#debug-panel");
  const debugNav = page.locator("#debug-open");
  await expect(panel).toBeHidden();
  await debugNav.click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(panel.getByRole("heading", { name: "DEBUG LOG" })).toBeVisible();
  await expect(page.locator("#session-log")).not.toBeEmpty();
  await expect(debugNav).toBeVisible();
  await expect(debugNav).toHaveAttribute("aria-pressed", "true");
  await debugNav.click();
  await expect(panel).toBeHidden();
  await expect(debugNav).toHaveAttribute("aria-pressed", "false");
});

test("shows status line with rate after rates load", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  const status = page.locator("#status-line");
  await expect(status).toBeVisible();
  await expect(status).toContainText(/1 ZAR/i);
  await expect(status).toContainText(/USD/i);
  await expect(status).toContainText(/0[.,]0558/);
});

test("glance strip shows EUR and BTC defaults when ZAR to USD", async ({
  page,
}) => {
  await mockCoinbase(page);
  await page.goto("/");
  const strip = page.locator("#glance-strip");
  await expect(strip).toBeVisible();
  await expect(strip.locator(".glance-code", { hasText: "EUR" })).toBeVisible();
  await expect(strip.locator(".glance-code", { hasText: "BTC" })).toBeVisible();
  await expect(strip.locator(".glance-code", { hasText: "USD" })).toHaveCount(0);
});

test("bank fee 2.5% shrinks displayed USD result", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  await expect(page.locator("#result")).toHaveValue(/0[.,]0558/);
  await page.locator(".extras summary").click();
  await page.locator("#fee-percent").fill("2.5");
  await expect(page.locator("#result")).toHaveValue(/0[.,]0544/);
  await expect(page.locator("#status-line")).toContainText(/Fee 2\.5%/);
});

test("amount inputs keep at least 16px font to avoid mobile focus zoom", async ({
  page,
}) => {
  await mockCoinbase(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const sizes = await page.evaluate(() => {
    const px = (id: string) =>
      parseFloat(getComputedStyle(document.getElementById(id)!).fontSize);
    return {
      amount: px("amount"),
      result: px("result"),
      fee: px("fee-percent"),
    };
  });
  expect(sizes.amount).toBeGreaterThanOrEqual(16);
  expect(sizes.result).toBeGreaterThanOrEqual(16);
  expect(sizes.fee).toBeGreaterThanOrEqual(16);
});

test("copy result button writes clipboard payload", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockCoinbase(page);
  await page.goto("/");
  await expect(page.locator("#result")).toHaveValue(/0[.,]0558/);
  await page.locator("#copy-result").click();
  await expect(page.locator("#copy-result")).toHaveText(/Copied/i);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/0[.,]0558 USD/);
});
