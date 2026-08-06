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

test("shows the donation QR codes in the tip jar", async ({ page }) => {
  await page.goto("/");
  await page.locator("#tip-open").click();
  const qr = page.getByAltText("Donation QR codes for BTC and USDC");
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute("src", "/qr/donations.jpeg");
  await expect(qr).toHaveJSProperty("complete", true);
});
