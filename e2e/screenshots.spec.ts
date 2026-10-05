/**
 * Not assertions: renders every page in both themes into screenshots/ for visual review
 * (attach them to a PR when the UI changes). Run with `npm run screenshots`.
 */
import { expect, test } from "@playwright/test";

const px = (n: number) => 160 * n + 10 * (n - 1);

for (const theme of ["light", "dark"] as const) {
  for (const scenario of ["agile", "scrum", "empty"]) {
    test(`hub ${scenario} ${theme} @screenshot`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`hub.html?scenario=${scenario}&theme=${theme}`);
      await expect(page.locator("#status")).toBeHidden();
      await page.screenshot({ path: `screenshots/hub-${scenario}-${theme}.png`, fullPage: true });
    });
  }

  for (const [cols, rows] of [[2, 2], [4, 3], [6, 4]]) {
    test(`widget ${cols}x${rows} ${theme} @screenshot`, async ({ page }) => {
      await page.setViewportSize({ width: px(cols), height: px(rows) });
      await page.goto(`widget.html?cols=${cols}&rows=${rows}&theme=${theme}`);
      await expect.poll(() => page.evaluate(() => (window as any).__mock.hostResult)).toBeTruthy();
      await page.screenshot({ path: `screenshots/widget-${cols}x${rows}-${theme}.png` });
    });
  }

  test(`config ${theme} @screenshot`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 620 });
    await page.goto(`config.html?theme=${theme}`);
    await expect.poll(() => page.evaluate(() => (window as any).__mock.hostResult)).toBeTruthy();
    await page.screenshot({ path: `screenshots/config-${theme}.png` });
  });
}
