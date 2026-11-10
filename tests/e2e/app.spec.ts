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
  await expect(page.locator("#from-trigger")).toContainText("ZAR");
  await expect(page.locator("#to-trigger")).toContainText("USD");
  await expect(page.locator("#result")).toHaveValue(/0[.,]0558/);
  const before = mock.requests;
  await page.locator("#amount").fill("2");
  await expect(page.locator("#result")).toHaveValue(/0[.,]1116/);
  expect(mock.requests).toBe(before);
});

test("currency picker lists many currencies and updates the pair", async ({
  page,
}) => {
  await page.route("https://api.coinbase.com/**", async (route) => {
    const url = route.request().url();
    if (url.includes("currency=EUR")) {
      await route.fulfill({
        json: {
          data: {
            currency: "EUR",
            rates: {
              USD: "1.08",
              ZAR: "19.5",
              EUR: "1",
              BTC: "0.00002",
            },
          },
        },
      });
      return;
    }
    await route.fulfill({ json: zarRates });
  });
  await page.goto("/");
  await page.locator("#from-trigger").click();
  const picker = page.locator("#currency-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("heading", { name: /from currency/i })).toBeVisible();
  await expect(picker.locator(".currency-option")).toHaveCount(20);
  await expect(picker.getByRole("button", { name: /USD US Dollar/i })).toBeVisible();
  await expect(picker.getByRole("button", { name: /EUR Euro/i })).toBeVisible();
  await expect(picker.getByRole("button", { name: /BTC Bitcoin/i })).toBeVisible();
  await picker.getByRole("button", { name: /EUR Euro/i }).click();
  await expect(picker).toBeHidden();
  await expect(page.locator("#from-trigger")).toContainText("EUR");

  await page.locator("#to-trigger").click();
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("heading", { name: /to currency/i })).toBeVisible();
  await picker.getByRole("button", { name: /BTC Bitcoin/i }).click();
  await expect(page.locator("#to-trigger")).toContainText("BTC");
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

test("swap toggles between 1-from and 1-to modes", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  await page.locator("#amount").fill("1");
  await expect(page.locator("#result")).toHaveValue(/0[.,]0558/);
  await page.locator("#swap").click();
  await expect(page.locator("#from-trigger")).toContainText("ZAR");
  await expect(page.locator("#to-trigger")).toContainText("USD");
  await expect(page.locator("#result")).toHaveValue("1");
  await expect
    .poll(async () => {
      const v = await page.locator("#amount").inputValue();
      return Number(v.replace(/\s/g, "").replace(",", "."));
    })
    .toBeCloseTo(17.9211, 3);
  await page.locator("#swap").click();
  await expect(page.locator("#amount")).toHaveValue("1");
  await expect(page.locator("#result")).toHaveValue(/0[.,]0558/);
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

test("hides tip donations on App Store shell (?forceNoTips)", async ({
  page,
}) => {
  await page.goto("/?forceNoTips=1");
  await expect(page.locator("#tip-open")).toHaveCount(0);
  await expect(page.locator("#tip-dialog")).toHaveCount(0);
  await expect(page.getByAltText(/donation QR code/i)).toHaveCount(0);
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

test("main page has no glance strip or bank fee", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  await expect(page.locator("#glance-strip")).toHaveCount(0);
  await expect(page.locator(".extras")).toHaveCount(0);
  await expect(page.locator("#fee-percent")).toHaveCount(0);
  await expect(page.locator("#favorites")).toHaveCount(0);
});
