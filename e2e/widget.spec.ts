import type { Page } from "@playwright/test";
import { calls, dots, expect, inClause, lastWiql, test } from "./fixtures.ts";

const mock = (page: Page) => page.evaluate(() => {
  const m = (window as any).__mock;
  return { result: m.hostResult, error: m.hostError, notifications: m.notifications };
});

async function openWidget(page: Page, query: string, size: { cols: number; rows: number } = { cols: 4, rows: 3 }) {
  const px = (n: number) => 160 * n + 10 * (n - 1);
  await page.setViewportSize({ width: px(size.cols), height: px(size.rows) });
  await page.goto(`widget.html?cols=${size.cols}&rows=${size.rows}&${query}`);
  await expect.poll(async () => { const m = await mock(page); return m.result ?? m.error; }).toBeTruthy();
}

test.describe("dashboard widget", () => {
  test("defaults to the dashboard team and reports success", async ({ page }) => {
    await openWidget(page, "team=team-a&name=Team%20A%20WIP");
    expect((await mock(page)).result).toEqual({ statusType: 0 });
    await expect(page.locator("#title")).toHaveText("Team A WIP");
    expect(await lastWiql(page)).toContain("[System.AreaPath] UNDER 'Demo\\Team A'");
    await expect(page.locator("#take")).toHaveText(/^\d+ of \d+ in the same state for more than 1 year$/);
    expect(await dots(page).count()).toBeGreaterThan(0);
  });

  test("shows a loader until the chart is drawn", async ({ page }) => {
    await page.goto("widget.html?delay=100");
    await expect(page.locator("#loading")).toBeVisible();
    await expect(page.locator("#loading .spinner")).toBeVisible();
    await expect.poll(async () => (await mock(page)).result, { timeout: 15_000 }).toEqual({ statusType: 0 });
    await expect(page.locator("#loading")).toBeHidden();
    expect(await dots(page).count()).toBeGreaterThan(0);
  });

  test("project dashboard (no team) queries the whole project", async ({ page }) => {
    await openWidget(page, "team=none");
    expect(await lastWiql(page)).not.toContain("System.AreaPath");
  });

  test("stored settings win over defaults", async ({ page }) => {
    const settings = JSON.stringify({ teamId: "team-b", thresholdDays: 90, states: ["Active"], types: ["Bug"] });
    await openWidget(page, `team=team-a&settings=${encodeURIComponent(settings)}`);
    const q = await lastWiql(page);
    expect(q).toContain("[System.AreaPath] = 'Demo\\Team B'");
    expect(inClause(q, "System.State")).toEqual(["Active"]);
    expect(inClause(q, "System.WorkItemType")).toEqual(["Bug"]);
    await expect(page.locator("#take")).toContainText("more than 90 days");
    await expect(page.locator("#chart .thr-label")).toHaveText("90 days in the same state");
  });

  for (const [cols, rows] of [[2, 2], [3, 2], [4, 3], [6, 4]]) {
    test(`fits a ${cols}×${rows} tile without overflow`, async ({ page }) => {
      await openWidget(page, "", { cols, rows });
      const viewport = page.viewportSize()!;
      const svg = (await page.locator("#chart svg").boundingBox())!;
      const take = (await page.locator("#take").boundingBox())!;
      expect(svg.x + svg.width).toBeLessThanOrEqual(viewport.width);
      expect(svg.y + svg.height).toBeLessThanOrEqual(take.y + 1);
      expect(take.y + take.height).toBeLessThanOrEqual(viewport.height);
    });
  }

  test("failures reach the dashboard as a user-visible message", async ({ page }) => {
    await openWidget(page, "scenario=error");
    expect((await mock(page)).error).toMatchObject({ isUserVisible: true, message: expect.stringContaining("VS402337") });
    await expect(page.locator("#loading")).toBeHidden();
  });

  test("redraws on theme change without new requests", async ({ page }) => {
    await openWidget(page, "theme=dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const sent = (await calls(page)).length;
    await page.evaluate(() => (window as any).__mock.setTheme("light"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect((await calls(page)).length).toBe(sent);
  });
});

test.describe("widget configuration", () => {
  const CHANGE = "ms.vss-dashboards-web.configurationChange";
  const lastSettings = async (page: Page) => {
    const n = (await mock(page)).notifications;
    expect(n.length).toBeGreaterThan(0);
    expect(n[n.length - 1].event).toBe(CHANGE);
    return JSON.parse(n[n.length - 1].data.data);
  };
  const openConfig = async (page: Page, query = "") => {
    await page.goto(`config.html?${query}`);
    await expect.poll(async () => (await mock(page)).result).toEqual({ statusType: 0 });
  };

  test("starts from the dashboard team and default lists", async ({ page }) => {
    await openConfig(page);
    await expect(page.locator("#team")).toHaveValue("__dashboard__");
    await expect(page.locator("#threshold")).toHaveValue("365");
    await expect(page.locator("#states label")).toHaveText(["Active", "OnHold", "For Testing", "Resolved"]);
    expect((await mock(page)).notifications).toEqual([]);
  });

  test("every change notifies the host with the full settings", async ({ page }) => {
    await openConfig(page);
    await page.selectOption("#threshold", "180");
    expect(await lastSettings(page)).toEqual({ types: [], states: [], thresholdDays: 180 }); // teamId omitted = dashboard team

    await page.selectOption("#team", "");
    expect(await lastSettings(page)).toMatchObject({ teamId: "", thresholdDays: 180 });

    await page.locator("#states label", { hasText: "OnHold" }).locator("input").uncheck();
    expect((await lastSettings(page)).states).toEqual(["Active", "For Testing", "Resolved"]);

    await page.locator("#types label", { hasText: "Task" }).locator("input").check();
    expect(await lastSettings(page)).toMatchObject({ types: ["Bug", "Task", "User Story"], states: [] });

    const saved = await page.evaluate(() => (window as any).__mock.save());
    expect(saved.isValid).toBe(true);
    expect(JSON.parse(saved.customSettings.data)).toEqual(await lastSettings(page));
  });

  test("shows stored settings", async ({ page }) => {
    const settings = JSON.stringify({ teamId: "team-b", thresholdDays: 30, states: ["OnHold"], types: ["User Story"] });
    await openConfig(page, `settings=${encodeURIComponent(settings)}`);
    await expect(page.locator("#team")).toHaveValue("team-b");
    await expect(page.locator("#threshold")).toHaveValue("30");
    await expect(page.locator("#states input:checked")).toHaveCount(1);
    await expect(page.locator("#types input:checked")).toHaveCount(1);
  });
});
