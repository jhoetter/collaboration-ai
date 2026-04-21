import { expect, test } from "@playwright/test";

test("login renders @visual", async ({ page }) => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Requires running web server");
  await page.goto("/auth/login");
  await expect(page).toHaveScreenshot("login.png", { maxDiffPixelRatio: 0.02 });
});
