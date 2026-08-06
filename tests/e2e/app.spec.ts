import { expect, test } from "@playwright/test";
test("opens with the default pair and converts without refetching on input", async ({
  page,
}) => {
  let requests = 0;
  await page.route("https://api.coinbase.com/**", async (route) => {
    requests += 1;
    await route.fulfill({
      json: { data: { currency: "ZAR", rates: { USD: "0.0558", ZAR: "1" } } },
    });
  });
  await page.goto("/");
  await expect(page.locator("#from")).toHaveValue("ZAR");
  await expect(page.locator("#to")).toHaveValue("USD");
  await expect(page.locator("#result")).toHaveValue(/0[.,]0558/);
  const before = requests;
  await page.locator("#amount").fill("2");
  await expect(page.locator("#result")).toHaveValue(/0[.,]1116/);
  expect(requests).toBe(before);
});

test("editing the bottom amount updates the top without refetching", async ({
  page,
}) => {
  let requests = 0;
  await page.route("https://api.coinbase.com/**", async (route) => {
    requests += 1;
    await route.fulfill({
      json: { data: { currency: "ZAR", rates: { USD: "0.0558", ZAR: "1" } } },
    });
  });
  await page.goto("/");
  await expect(page.locator("#result")).toHaveValue(/0[.,]0558/);
  const before = requests;
  await page.locator("#result").fill("1");
  await expect(page.locator("#amount")).toHaveValue(/17[.,]9211/);
  expect(requests).toBe(before);
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
