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
  await expect(page.locator("#amount")).toHaveValue(/^17[.,]92$/);
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
    .toBeCloseTo(17.92, 2);
  await page.locator("#swap").click();
  await expect(page.locator("#amount")).toHaveValue("1");
  await expect(page.locator("#result")).toHaveValue(/0[.,]0558/);
});

test("swap keeps the typed amount and inverts the direction", async ({
  page,
}) => {
  await mockCoinbase(page);
  await page.goto("/");
  await page.locator("#amount").fill("100");
  await expect(page.locator("#result")).toHaveValue(/5[.,]58/);
  await page.locator("#swap").click();
  await expect(page.locator("#from-trigger")).toContainText("ZAR");
  await expect(page.locator("#to-trigger")).toContainText("USD");
  await expect(page.locator("#result")).toHaveValue("100");
  await expect
    .poll(async () => {
      const v = await page.locator("#amount").inputValue();
      return Number(v.replace(/[\s,]/g, ""));
    })
    .toBeCloseTo(1792.11, 1);
  await page.locator("#swap").click();
  await expect(page.locator("#amount")).toHaveValue("100");
  await expect(page.locator("#result")).toHaveValue(/5[.,]58/);
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

test("opens diagnostics from settings", async ({ page }) => {
  await page.goto("/");
  const panel = page.locator("#debug-panel");
  await expect(panel).toBeHidden();
  await expect(page.locator("#debug-open")).toBeHidden();
  await page.locator("#design-open").click();
  await expect(page.locator("#design-dialog").getByRole("heading", { name: "SETTINGS" })).toBeVisible();
  await page.locator("#debug-open").click();
  await expect(panel).toBeVisible();
  await expect(page.locator("#design-dialog")).toBeHidden();
  await expect(panel.getByRole("heading", { name: "DIAGNOSTICS" })).toBeVisible();
  await expect(page.locator("#session-log")).not.toBeEmpty();
  await panel.getByRole("button", { name: "Close diagnostics" }).click();
  await expect(panel).toBeHidden();
});

test("shows the pair rate and freshness, and refreshes on tap", async ({ page }) => {
  const api = await mockCoinbase(page);
  await page.goto("/");
  const status = page.locator("#rate-status");
  await expect(status).toHaveAttribute("data-kind", "fresh");
  await expect(status).toContainText("LIVE");
  await expect(status).toContainText(/1 ZAR = 0[.,]0558 USD/);
  const before = api.requests;
  await status.click();
  await expect.poll(() => api.requests).toBeGreaterThan(before);
});

test("shows a retryable error when rates can't load", async ({ page }) => {
  await page.route("https://api.coinbase.com/**", (route) => route.abort());
  await page.goto("/");
  const status = page.locator("#rate-status");
  await expect(status).toHaveAttribute("data-kind", "error");
  await expect(status).toContainText("TAP TO RETRY");
});

test("picker search filters, and picking the other side swaps the pair", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  await page.locator("#from-trigger").click();
  const picker = page.locator("#currency-picker");
  await page.locator("#currency-search").fill("yen");
  await expect(picker.locator(".currency-option:visible")).toHaveCount(1);
  await page.locator("#currency-search").fill("");
  await picker.getByRole("button", { name: /USD US Dollar/i }).click();
  await expect(page.locator("#from-trigger")).toContainText("USD");
  await expect(page.locator("#to-trigger")).toContainText("ZAR");
});

test("letters can't be typed into an amount", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  await page.locator("#amount").fill("");
  await page.locator("#amount").pressSequentially("12ab3");
  await expect(page.locator("#amount")).toHaveValue("123");
});

test("text inputs keep at least 16px font to avoid iOS focus zoom", async ({
  page,
}) => {
  await mockCoinbase(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const px = (id: string) =>
    page.evaluate(
      (el) => parseFloat(getComputedStyle(document.getElementById(el)!).fontSize),
      id,
    );
  expect(await px("amount")).toBeGreaterThanOrEqual(16);
  expect(await px("result")).toBeGreaterThanOrEqual(16);
  expect(await px("currency-search")).toBeGreaterThanOrEqual(16);
});

test("main page has no glance strip or bank fee", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  await expect(page.locator("#glance-strip")).toHaveCount(0);
  await expect(page.locator(".extras")).toHaveCount(0);
  await expect(page.locator("#fee-percent")).toHaveCount(0);
  await expect(page.locator("#favorites")).toHaveCount(0);
});

test("large text switch steps labels up and persists", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  await page.locator("#design-open").click();
  const toggle = page.locator("#large-text");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-text", "large");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-text", "large");
});

test("recent picks appear at the top of the picker; Enter picks the best match", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  await page.locator("#to-trigger").click();
  await page.locator("#currency-search").fill("eur");
  await page.locator("#currency-search").press("Enter");
  await expect(page.locator("#to-trigger")).toContainText("EUR");
  await page.locator("#to-trigger").click();
  // the only recent pick is the current one, which isn't repeated
  await expect(page.locator("#currency-recents")).toBeHidden();
  await page.locator("#currency-picker").getByRole("button", { name: /USD US Dollar/ }).click();
  await page.locator("#to-trigger").click();
  await expect(page.locator("#currency-recents")).toBeVisible();
  await page.locator(".recent-chip", { hasText: "EUR" }).click();
  await expect(page.locator("#to-trigger")).toContainText("EUR");
});

test.describe("comma-decimal locale (en-ZA)", () => {
  test.use({ locale: "en-ZA" });

  test("reads 0,125 as a decimal, groups on blur, and copies what it shows", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mockCoinbase(page);
    await page.goto("/");
    const amount = page.locator("#amount");
    await amount.fill("1250,5");
    await expect(page.locator("#result")).toHaveValue("69,78");
    await amount.blur();
    await expect(amount).toHaveValue(/^1\s250,5$/);
    await amount.focus();
    await expect(amount).toHaveValue("1250,5");
    await page.locator("#result-copy").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("69,78");

    await amount.fill("0,125");
    await expect(page.locator("#result")).toHaveValue(/^0,00697/);
    await amount.fill("1,5,5");
    await expect(page.locator("#amount-error")).toHaveText("NUMBERS ONLY");
    await expect(page.locator("#result")).toHaveValue("");
  });

  test("a pasted foreign-format price keeps its value", async ({ page }) => {
    await mockCoinbase(page);
    await page.goto("/");
    await page.locator("#amount").fill("$1,250.50");
    await expect(page.locator("#result")).toHaveValue("69,78"); // 1250.50 × 0.0558
  });
});

test("pasted prices in either format keep their value (en-US)", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  await page.locator("#amount").fill("€1.250,50");
  await expect(page.locator("#result")).toHaveValue("69.78");
  await page.locator("#amount").fill("R 1 250,50");
  await expect(page.locator("#result")).toHaveValue("69.78");
});

test("pasting text with several numbers keeps the first one", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  const amount = page.locator("#amount");
  await amount.focus();
  await page.evaluate(() => {
    const el = document.getElementById("amount") as HTMLInputElement;
    el.value = "Total: 1,250.50 (15% VAT)";
    el.dispatchEvent(new InputEvent("input", { inputType: "insertFromPaste", bubbles: true }));
  });
  await expect(amount).toHaveValue("1,250.50");
  await expect(page.locator("#result")).toHaveValue("69.78");
});

test("a 13th whole digit is refused with MAX LENGTH", async ({ page }) => {
  await mockCoinbase(page);
  await page.goto("/");
  await page.locator("#amount").fill("1234567890123");
  await expect(page.locator("#amount")).toHaveValue("123456789012");
  await expect(page.locator("#amount-error")).toHaveText("MAX LENGTH");
  await page.locator("#amount").fill("12");
  await expect(page.locator("#amount-error")).toHaveText("");
});
