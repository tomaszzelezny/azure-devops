import { calls, chipLabels, dots, expect, hubRow, inClause, lastWiql, openHub, test } from "./fixtures.ts";

const ANCHORS = { stuckInTesting: 1001, fresh: 1002, restarted: 1003, longHistory: 1004, renamedState: 1005, teamB: 1006, closed: 1007, notStarted: 1008, task: 1009 };

test.describe("hub · agile process", () => {
  test("defaults: requirement + bug types, InProgress/Resolved states in workflow order", async ({ page }) => {
    await openHub(page);
    expect(await chipLabels(page, "types")).toEqual(["Bug", "Task (off)", "User Story"]); // Test Plan is hidden
    expect(await chipLabels(page, "states")).toEqual(["Active", "OnHold", "For Testing", "Resolved"]);

    const q = await lastWiql(page);
    expect(inClause(q, "System.WorkItemType")).toEqual(["User Story", "Bug"]);
    expect(inClause(q, "System.State")).toEqual(["Active", "OnHold", "For Testing", "Resolved"]);
    expect(q).not.toContain("System.AreaPath"); // entire project

    const expected = await page.evaluate(() => (window as any).__mock.scenario.items.filter((i: any) =>
      ["User Story", "Bug"].includes(i.type) && ["Active", "OnHold", "For Testing", "Resolved"].includes(i.state)).length);
    await expect(dots(page)).toHaveCount(expected);
    await expect(page.locator("#take")).toHaveText(new RegExp(`^\\d+ of ${expected} items have been in the same state for more than 1 year\\.`));
  });

  test("age counts from the first start, time in state from the last change", async ({ page }) => {
    await openHub(page);
    expect(await hubRow(page, ANCHORS.stuckInTesting)).toMatchObject({ state: "For Testing", age: 450, inState: 400 });
    expect(await hubRow(page, ANCHORS.fresh)).toMatchObject({ age: 10, inState: 10 });
    expect(await hubRow(page, ANCHORS.restarted)).toMatchObject({ age: 250, inState: 50 });
    expect(await hubRow(page, ANCHORS.renamedState)).toMatchObject({ age: 80, inState: 80 }); // no start in history: falls back to the current state
    expect(await hubRow(page, ANCHORS.closed)).toBeUndefined();
    expect(await hubRow(page, ANCHORS.notStarted)).toBeUndefined();
    expect(await hubRow(page, ANCHORS.task)).toBeUndefined();
  });

  test("history paging: a start on the second page of updates is found", async ({ page }) => {
    await openHub(page);
    expect(await hubRow(page, ANCHORS.longHistory)).toMatchObject({ state: "OnHold", age: 100, inState: 30 });
    const pages = (await calls(page)).filter((c) => c.path.startsWith(`_apis/wit/workItems/${ANCHORS.longHistory}/updates`)).map((c) => c.path);
    expect(pages).toEqual([
      expect.stringContaining("$top=200&$skip=0"),
      expect.stringContaining("$top=200&$skip=200"),
    ]);
  });

  test("one history request per item in the common case, batches of at most 200 ids", async ({ page }) => {
    await openHub(page);
    const all = await calls(page);
    const updates = all.filter((c) => c.path.includes("/updates"));
    const n = await dots(page).count();
    expect(updates.length).toBe(n + 1); // + the second page of the long-history anchor
    for (const b of all.filter((c) => c.path.includes("workitemsbatch"))) expect(b.body.ids.length).toBeLessThanOrEqual(200);
  });

  test("team filter adds the team's area paths and is remembered", async ({ page }) => {
    await openHub(page);
    await page.selectOption("#team", "team-b");
    await expect.poll(() => lastWiql(page)).toContain("[System.AreaPath] = 'Demo\\Team B'");
    await expect(page.locator("#status")).toBeHidden();
    expect(await hubRow(page, ANCHORS.teamB)).toMatchObject({ age: 60, inState: 20 });
    expect(await hubRow(page, ANCHORS.stuckInTesting)).toBeUndefined();

    await page.reload();
    await expect(page.locator("#status")).toBeHidden();
    await expect(page.locator("#team")).toHaveValue("team-b");

    await page.selectOption("#team", "team-a");
    await expect.poll(() => lastWiql(page)).toContain("[System.AreaPath] UNDER 'Demo\\Team A'");
  });

  test("state and type filters drive the query; the last state cannot be unchecked", async ({ page }) => {
    await openHub(page);
    await page.locator("#states label", { hasText: "For Testing" }).locator("input").uncheck();
    await expect.poll(async () => inClause(await lastWiql(page), "System.State")).toEqual(["Active", "OnHold", "Resolved"]);
    await expect(page.locator("#status")).toBeHidden();
    expect(await hubRow(page, ANCHORS.stuckInTesting)).toBeUndefined();

    for (const s of ["Active", "OnHold"]) await page.locator("#states label", { hasText: s }).locator("input").uncheck();
    const last = page.locator("#states label", { hasText: "Resolved" }).locator("input");
    await last.uncheck({ force: true }).catch(() => {});
    await expect(last).toBeChecked();

    await page.locator("#types label", { hasText: "Task" }).locator("input").check();
    await expect.poll(async () => inClause(await lastWiql(page), "System.WorkItemType")).toContain("Task");
    // Changing types resets the state selection to the defaults for the new types.
    expect(await chipLabels(page, "states")).toEqual(["Active", "OnHold", "For Testing", "Resolved"]);
    await expect(page.locator("#status")).toBeHidden();
    expect(await hubRow(page, ANCHORS.task)).toMatchObject({ age: 12, inState: 12 });
  });

  test("legend hides and shows a state without reloading", async ({ page }) => {
    await openHub(page);
    const before = await dots(page).count();
    const sent = (await calls(page)).length;
    const active = page.locator("#legend button", { hasText: "Active" });
    const activeCount = Number((await active.locator(".n").textContent()) ?? 0);
    await active.click();
    await expect(active).toHaveAttribute("aria-pressed", "false");
    await expect(dots(page)).toHaveCount(before - activeCount);
    await active.click();
    await expect(dots(page)).toHaveCount(before);
    expect((await calls(page)).length).toBe(sent);
  });

  test("threshold line and summary follow the threshold", async ({ page }) => {
    await openHub(page);
    await page.selectOption("#threshold", "90");
    await expect(page.locator("#chart .thr-label")).toHaveText("90 days in the same state");
    await expect(page.locator("#take")).toContainText("for more than 90 days");
  });

  test("clicking a dot or a table link opens the work item", async ({ page }) => {
    await openHub(page);
    await page.locator("summary").click();
    await page.locator(`#table a[data-id="${ANCHORS.stuckInTesting}"]`).click();
    expect(await page.evaluate(() => (window as any).__mock.opened)).toEqual([ANCHORS.stuckInTesting]);

    await page.locator("#chart").scrollIntoViewIfNeeded();
    const box = (await dots(page).first().boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator(".tip")).toBeVisible();
    const tipId = Number((await page.locator(".tip .mono").textContent())!.replace("#", ""));
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await page.evaluate(() => (window as any).__mock.opened)).toEqual([ANCHORS.stuckInTesting, tipId]);
  });

  test("follows the host theme", async ({ page }) => {
    await openHub(page, "theme=dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.evaluate(() => (window as any).__mock.setTheme("light"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test.describe("hub · other processes and failures", () => {
  test("scrum: PBI + Bug, Committed", async ({ page }) => {
    await openHub(page, "scenario=scrum");
    expect(await chipLabels(page, "types")).toEqual(["Bug", "Product Backlog Item", "Task (off)"]);
    expect(await chipLabels(page, "states")).toEqual(["Committed"]);
    expect(await hubRow(page, 1101)).toMatchObject({ age: 30, inState: 30 });
  });

  test("process without StateChangeDate: time in state comes from history", async ({ page }) => {
    await openHub(page, "scenario=no-state-change-date");
    const batch = (await calls(page)).find((c) => c.path.includes("workitemsbatch"))!;
    expect(batch.body.fields).toContain("Microsoft.VSTS.Common.StateChangeDate");
    expect(await hubRow(page, ANCHORS.stuckInTesting)).toMatchObject({ age: 450, inState: 400 });
    expect(await hubRow(page, ANCHORS.restarted)).toMatchObject({ age: 250, inState: 50 });
    expect(await hubRow(page, ANCHORS.longHistory)).toMatchObject({ age: 100, inState: 30 });
  });

  test("nothing in progress", async ({ page }) => {
    await openHub(page, "scenario=empty");
    await expect(dots(page)).toHaveCount(0);
    await expect(page.locator("#take")).toHaveText("No open work items in the selected states.");
  });

  test("shows a loader while data is fetched, also on refresh", async ({ page }) => {
    await page.goto("hub.html?delay=100");
    const loader = page.locator("#status.loading");
    await expect(loader).toBeVisible();
    await expect(loader.locator(".spinner")).toBeVisible();
    await expect(page.locator("#result")).toBeHidden();
    await expect(page.locator("#status")).toBeHidden({ timeout: 15_000 });
    await expect(page.locator("#result")).toBeVisible();

    await page.click("#refresh");
    await expect(loader).toBeVisible();
    await expect(page.locator("#status")).toBeHidden({ timeout: 15_000 });
    await expect(dots(page).first()).toBeVisible();
  });

  test("API errors are shown to the user", async ({ page }) => {
    await page.goto("hub.html?scenario=error");
    await expect(page.locator("#status .spinner")).toHaveCount(0);
    await expect(page.locator("#status.err")).toContainText("VS402337");
    await expect(page.locator("#result")).toBeHidden();
  });
});
