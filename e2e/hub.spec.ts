import { readFileSync } from "node:fs";
import { calls, chipLabels, dots, downloadReport, expect, hubRow, inClause, lastWiql, openHub, test } from "./fixtures.ts";

const ANCHORS = { stuckInTesting: 1001, fresh: 1002, restarted: 1003, longHistory: 1004, renamedState: 1005, teamB: 1006, closed: 1007, notStarted: 1008, task: 1009 };

test.describe("hub · agile process", () => {
  test("defaults: requirement, bug and task types, InProgress/Resolved states in workflow order", async ({ page }) => {
    await openHub(page);
    expect(await chipLabels(page, "types")).toEqual(["Bug", "Task", "User Story"]); // Test Plan is hidden
    expect(await chipLabels(page, "states")).toEqual(["Active", "OnHold", "For Testing", "Resolved"]);

    const q = await lastWiql(page);
    expect(inClause(q, "System.WorkItemType")).toEqual(["User Story", "Bug", "Task"]);
    expect(inClause(q, "System.State")).toEqual(["Active", "OnHold", "For Testing", "Resolved"]);
    expect(q).not.toContain("System.AreaPath"); // entire project

    const expected = await page.evaluate(() => (window as any).__mock.scenario.items.filter((i: any) =>
      ["User Story", "Bug", "Task"].includes(i.type) && ["Active", "OnHold", "For Testing", "Resolved"].includes(i.state)).length);
    await expect(dots(page)).toHaveCount(expected);
    await expect(page.locator("#take")).toHaveText(new RegExp(`^\\d+ of ${expected} items started more than 1 year ago\\.`));
  });

  test("age counts from the first start, time in state from the last change", async ({ page }) => {
    await openHub(page);
    expect(await hubRow(page, ANCHORS.stuckInTesting)).toMatchObject({ state: "For Testing", age: 450, inState: 400 });
    expect(await hubRow(page, ANCHORS.fresh)).toMatchObject({ age: 10, inState: 10 });
    expect(await hubRow(page, ANCHORS.restarted)).toMatchObject({ age: 250, inState: 50 });
    expect(await hubRow(page, ANCHORS.renamedState)).toMatchObject({ age: 80, inState: 80 }); // no start in history: falls back to the current state
    expect(await hubRow(page, ANCHORS.closed)).toBeUndefined();
    expect(await hubRow(page, ANCHORS.notStarted)).toBeUndefined();
    expect(await hubRow(page, ANCHORS.task)).toMatchObject({ age: 12, inState: 12 });
  });

  test("table columns: no Assigned to; the last one shows the iteration path", async ({ page }) => {
    await openHub(page);
    await expect(page.locator("#table th")).toHaveText(["ID", "Title", "Type", "State", "Days since start", "Days in state", "Iteration path"]);
    expect(await hubRow(page, ANCHORS.stuckInTesting)).toMatchObject({ iteration: "Demo\\Sprint 3" });
    expect(await hubRow(page, ANCHORS.fresh)).toMatchObject({ iteration: "Demo\\Sprint 12" });
    const batch = (await calls(page)).find((c) => c.path.includes("workitemsbatch"))!;
    expect(batch.body.fields).toContain("System.IterationPath");
  });

  test("Include current iteration: on by default; off leaves out the team's current iteration and is remembered", async ({ page }) => {
    await openHub(page);
    const box = page.locator("#current-iteration");
    await expect(box).toBeChecked();
    // Next to the threshold, in the first row: takes no extra screen space.
    const row = (sel: string) => page.locator(`.controls:has(${sel})`);
    await expect(row("#current-iteration")).toHaveCount(1);
    expect(await row("#current-iteration").evaluate((r) => r.contains(document.getElementById("threshold")))).toBe(true);
    expect(await lastWiql(page)).not.toContain("System.IterationPath");
    expect((await calls(page)).some((c) => c.path.includes("teamsettings/iterations"))).toBe(false);
    expect(await hubRow(page, ANCHORS.fresh)).toBeDefined();

    // Entire project: the default team's (Team A) current iteration, children included.
    await box.uncheck();
    await expect.poll(() => lastWiql(page)).toContain("[System.IterationPath] NOT UNDER 'Demo\\Sprint 12'");
    await expect(page.locator("#status")).toBeHidden();
    const it = (await calls(page)).filter((c) => c.path.includes("teamsettings/iterations"));
    expect(it.map((c) => c.path)).toEqual([expect.stringMatching(/^Demo\/_apis\/work\/teamsettings\/iterations\?\$timeframe=current&/)]);
    expect(await hubRow(page, ANCHORS.fresh)).toBeUndefined(); // in Sprint 12
    expect(await hubRow(page, ANCHORS.task)).toBeUndefined(); // in Sprint 12\Week 2
    expect(await hubRow(page, ANCHORS.stuckInTesting)).toMatchObject({ age: 450, iteration: "Demo\\Sprint 3" });
    expect(await hubRow(page, ANCHORS.teamB)).toBeDefined(); // Team B's sprint is not Team A's

    await page.reload();
    await expect(page.locator("#status")).toBeHidden();
    await expect(box).not.toBeChecked();

    // A selected team uses its own current iteration.
    await page.selectOption("#team", "team-b");
    await expect.poll(() => lastWiql(page)).toContain("[System.IterationPath] NOT UNDER 'Demo\\Team B\\Sprint 3'");
    await expect(page.locator("#status")).toBeHidden();
    expect(await hubRow(page, ANCHORS.teamB)).toBeUndefined();

    await box.check();
    await expect.poll(() => lastWiql(page)).not.toContain("System.IterationPath");
    await expect(page.locator("#status")).toBeHidden();
    expect(await hubRow(page, ANCHORS.teamB)).toMatchObject({ age: 60, inState: 20 });
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

    await page.locator("#types label", { hasText: "Task" }).locator("input").uncheck();
    await expect.poll(async () => inClause(await lastWiql(page), "System.WorkItemType")).toEqual(["Bug", "User Story"]);
    // Changing types resets the state selection to the defaults for the new types.
    expect(await chipLabels(page, "states")).toEqual(["Active", "OnHold", "For Testing", "Resolved"]);
    await expect(page.locator("#status")).toBeHidden();
    expect(await hubRow(page, ANCHORS.task)).toBeUndefined();
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
    await expect(page.locator("#chart .thr-label")).toHaveText("90 days since work started");
    await expect(page.locator("#take")).toContainText("started more than 90 days ago");
  });

  test("clicking a dot or a table link opens the work item", async ({ page }) => {
    await openHub(page);
    await page.locator("#more").click();
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

  test("item list shows the five started longest ago, Days since start before Days in state; Show all expands it", async ({ page }) => {
    await openHub(page);
    const rows = page.locator("#table tbody tr");
    const total = await rows.count();
    expect(total).toBeGreaterThan(5);
    await expect(page.locator("#table tbody tr:visible")).toHaveCount(5);
    await expect(page.locator("#items h2")).toHaveText("Started longest ago");
    expect(await page.locator("#table th.num").allTextContents()).toEqual(["Days since start", "Days in state"]);
    const days = await page.locator("#table tbody tr:visible td:nth-child(5)").allTextContents();
    const nums = days.map((d) => Number(d.replace(/\D/g, "")));
    expect(nums).toEqual([...nums].sort((a, b) => b - a));

    const more = page.locator("#more");
    await expect(more).toHaveText(`Show all ${total} items ▾`);
    await more.click();
    await expect(page.locator("#table tbody tr:visible")).toHaveCount(total);
    await expect(more).toHaveText("Show fewer ▴");
    await expect(more).toHaveAttribute("aria-expanded", "true");

    // Stays expanded when the chart redraws.
    await page.selectOption("#threshold", "90");
    await expect(page.locator("#table tbody tr:visible")).toHaveCount(total);

    await more.click();
    await expect(page.locator("#table tbody tr:visible")).toHaveCount(5);
  });

  test("shows the extension version in the footer", async ({ page }) => {
    await openHub(page);
    const { version } = JSON.parse(readFileSync("vss-extension.json", "utf8"));
    await expect(page.locator("#version")).toHaveText(`Aging WIP v${version}`);
  });

  test("follows the host theme", async ({ page }) => {
    await openHub(page, "theme=dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.evaluate(() => (window as any).__mock.setTheme("light"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("Download report saves a PNG of the current view", async ({ page }) => {
    await openHub(page);
    const button = page.locator("#export");
    await expect(button).toBeEnabled();
    const file = await downloadReport(page);
    expect(file.suggestedFilename()).toMatch(/^aging-wip-demo-\d{4}-\d{2}-\d{2}\.png$/);
    const png = readFileSync((await file.path())!);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16), "width: 1184 px at 2×").toBe(2368);
    expect(png.readUInt32BE(20)).toBeGreaterThan(1200);
  });

  test("Download report is disabled while loading and when the legend hides every state", async ({ page }) => {
    await page.goto("hub.html?delay=200");
    await expect(page.locator("#export")).toBeDisabled();
    await expect(page.locator("#status")).toBeHidden({ timeout: 15_000 });
    await expect(page.locator("#export")).toBeEnabled();
    for (const lg of await page.locator("#legend button").all()) await lg.click();
    await expect(dots(page)).toHaveCount(0);
    await expect(page.locator("#export")).toBeDisabled();
    await expect(page.locator("#export")).toHaveAttribute("title", "No work items to report");
    await page.locator("#legend button").first().click();
    await expect(page.locator("#export")).toBeEnabled();
  });

  test("Download report asks for the language; the Azure DevOps language comes first", async ({ page }) => {
    await openHub(page, "culture=pl-PL");
    await page.click("#export");
    const menu = page.locator("#export-langs");
    await expect(menu.locator("button")).toHaveText(["Polski", "English"]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    const file = await downloadReport(page, "Polski");
    expect(readFileSync((await file.path())!).subarray(1, 4).toString()).toBe("PNG");
    await expect(menu).toHaveCount(0);

    await openHub(page);
    await page.click("#export");
    await expect(menu.locator("button")).toHaveText(["English", "Polski"]);
    await page.click("h1");
    await expect(menu).toHaveCount(0);
  });
});

test.describe("hub · requests that never answer", () => {
  const historyOf = async (page: import("@playwright/test").Page, id: number) =>
    (await calls(page)).filter((c) => c.path.startsWith(`_apis/wit/workItems/${id}/updates`));
  /**
   * Waits until every item but the stalled one is read: the loader shows "N-1 / N", as reported in v1.2.3.
   * The first progress update is not enough: under load the stalled request may not have been sent yet,
   * and moving the fake clock while other requests are in flight would time those out too.
   */
  const stalledOnLastItem = (page: import("@playwright/test").Page) => expect.poll(async () => {
    const m = (await page.locator("#status").textContent())?.match(/Reading work item history… (\d+) \/ (\d+)/);
    return m ? Number(m[2]) - Number(m[1]) : undefined;
  }, { message: "all items but the stalled one are read" }).toBe(1);

  test("a history request that never answers is cancelled and retried, so the loader does not hang", async ({ page }) => {
    await page.clock.install();
    await page.goto(`hub.html?stall=${ANCHORS.restarted}`);
    await stalledOnLastItem(page);
    await page.clock.runFor(29_000);
    await expect(page.locator("#status")).toBeVisible();

    await page.clock.runFor(5_000); // past the 30 s timeout and the 1 s pause before the retry
    await expect(page.locator("#status")).toBeHidden();
    expect(await hubRow(page, ANCHORS.restarted)).toMatchObject({ age: 250, inState: 50 });
    expect((await historyOf(page, ANCHORS.restarted)).map((c) => !!c.aborted)).toEqual([true, false]);
    await expect(page.locator("#reload-page")).toHaveCount(0); // recovered on its own: no reload hint
  });

  test("a load that stops progressing suggests reloading the page; giving up shows the error with a reload button", async ({ page }) => {
    await page.clock.install();
    await page.goto(`hub.html?stall=${ANCHORS.restarted}:3`); // every attempt stalls
    const status = page.locator("#status");
    await stalledOnLastItem(page);
    await expect(page.locator("#reload-page")).toHaveCount(0);

    await page.clock.runFor(46_000); // no progress for 45 s
    await expect(status.locator(".spinner")).toBeVisible();
    await expect(status).toContainText("Azure DevOps is not answering. If this does not finish, reload the page.");
    await expect(page.locator("#reload-page")).toBeVisible();

    await page.clock.runFor(60_000); // three attempts of 30 s with pauses between them
    await expect(page.locator("#status.err")).toContainText("no answer within 30 s");
    await expect(status).toContainText("Reload the page to try again.");
    expect((await historyOf(page, ANCHORS.restarted)).map((c) => !!c.aborted)).toEqual([true, true, true]);

    await page.evaluate(() => { (window as any).beforeReload = true; });
    await page.click("#reload-page");
    await expect.poll(() => page.evaluate(() => (window as any).beforeReload)).toBeUndefined();
  });

  test("changing filters mid-load cancels the old load and shows the new one", async ({ page }) => {
    await page.goto(`hub.html?stall=${ANCHORS.restarted}`);
    await stalledOnLastItem(page);
    await page.locator("#types label", { hasText: "Bug" }).click();

    await expect(page.locator("#status")).toBeHidden();
    expect(await chipLabels(page, "types")).toEqual(["Bug (off)", "Task", "User Story"]);
    expect(await hubRow(page, ANCHORS.fresh)).toBeUndefined(); // a bug
    expect(await hubRow(page, ANCHORS.restarted)).toMatchObject({ age: 250, inState: 50 });
    // The old load's stalled request was cancelled, not left running next to the new one.
    expect((await historyOf(page, ANCHORS.restarted)).map((c) => !!c.aborted)).toEqual([true, false]);
  });
});

test.describe("hub · other processes and failures", () => {
  test("scrum: PBI + Bug + Task, Committed and In Progress", async ({ page }) => {
    await openHub(page, "scenario=scrum");
    expect(await chipLabels(page, "types")).toEqual(["Bug", "Product Backlog Item", "Task"]);
    expect(await chipLabels(page, "states")).toEqual(["Committed", "In Progress"]);
    expect(await hubRow(page, 1101)).toMatchObject({ age: 30, inState: 30 });
  });

  test("items on the same spot are counted, listed and can each be opened", async ({ page }) => {
    await openHub(page, "scenario=scrum");
    expect(await hubRow(page, 1102)).toMatchObject({ age: 30, inState: 30 }); // same spot as 1101
    const n = await page.evaluate(() => (window as any).__mock.scenario.items.filter((i: any) =>
      ["Product Backlog Item", "Bug"].includes(i.type) && i.state === "Committed").length);
    await expect(dots(page)).toHaveCount(n); // every item still gets its dot

    // Centre of the dot each stack label belongs to (the label sits up and to the right of it).
    const stacks = await page.evaluate(() => [...document.querySelectorAll("#chart text.stack")].map((t) => {
      const lx = Number(t.getAttribute("x"));
      const dot = [...document.querySelectorAll("#chart circle.dot")].find((d) =>
        Math.abs(Number(d.getAttribute("cx")) + Number(d.getAttribute("r")) + 4 - lx) < 0.01 &&
        Math.abs(Number(d.getAttribute("cy")) - Number(d.getAttribute("r")) - Number(t.getAttribute("y"))) < 0.01)!;
      dot.scrollIntoView({ block: "center" });
      const b = dot.getBoundingClientRect();
      return { label: t.textContent!, x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }));
    let found = false;
    for (const st of stacks) {
      await page.mouse.move(st.x, st.y);
      if (!(await page.locator(".tip .it .mono").allTextContents()).includes("#1101")) continue;
      found = true;
      const count = Number(st.label.replace("×", ""));
      expect(count).toBeGreaterThanOrEqual(2);
      await expect(page.locator(".tip .t")).toHaveText(`${count} items on this spot`);
      await expect(page.locator(".tip .it")).toHaveCount(count);
      expect(await page.locator(".tip .it .mono").allTextContents()).toContain("#1102");

      // Clicking the stack pins a list; Escape closes it, picking an item opens that item.
      const menu = page.locator(".tip.menu");
      await page.mouse.click(st.x, st.y);
      await expect(menu.locator("button.it")).toHaveCount(count);
      expect(await page.evaluate(() => (window as any).__mock.opened)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await page.mouse.click(st.x, st.y);
      await menu.locator('button.it[data-id="1102"]').click();
      await expect(menu).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).__mock.opened)).toEqual([1102]);
      break;
    }
    expect(found).toBe(true);
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
    await expect(page.locator("#export")).toBeDisabled();
    await expect(page.locator("#export")).toHaveAttribute("title", "No work items to report");
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

  test("a web page instead of data (sign-in page, HTTP 203) is retried; the load then succeeds", async ({ page }) => {
    // As in v1.2.3 right after a type change: the WIQL call got HTML and the hub showed "Unexpected token '<'".
    await page.goto("hub.html?html=/_apis/wit/wiql");
    await expect(page.locator("#status")).toBeHidden({ timeout: 10_000 });
    expect(await hubRow(page, ANCHORS.stuckInTesting)).toMatchObject({ age: 450, inState: 400 });
    expect((await calls(page)).filter((c) => c.path.includes("/_apis/wit/wiql"))).toHaveLength(2);
  });

  test("a type disabled in the process while the hub is open goes away on Refresh", async ({ page }) => {
    await openHub(page);
    expect(await chipLabels(page, "types")).toEqual(["Bug", "Task", "User Story"]);
    await page.evaluate(() => { (window as any).__mock.scenario.process.types.find((t: any) => t.name === "Task").isDisabled = true; });

    await page.click("#refresh");
    await expect(page.locator("#status")).toBeHidden();
    expect(await chipLabels(page, "types")).toEqual(["Bug", "User Story"]);
    expect(inClause(await lastWiql(page), "System.WorkItemType")).toEqual(["User Story", "Bug"]);
    expect(await hubRow(page, ANCHORS.task)).toBeUndefined();
  });

  test("after a failed load the next one reads the work item types again", async ({ page }) => {
    await page.clock.install();
    await page.goto("hub.html?html=/_apis/wit/wiql:3");
    await page.clock.runFor(5_000);
    await expect(page.locator("#status.err")).toBeVisible();
    const typeReads = async () => (await calls(page)).filter((c) => c.path.includes("/_apis/wit/workitemtypes?")).length;
    expect(await typeReads()).toBe(1);

    await page.locator("#types label", { hasText: "Bug" }).click();
    await expect(page.locator("#status")).toBeHidden();
    expect(await typeReads()).toBe(2);
  });

  test("a web page every time ends in a readable error with the reload button, not a JSON parse error", async ({ page }) => {
    await page.clock.install();
    await page.goto("hub.html?html=/_apis/wit/wiql:3");
    await page.clock.runFor(5_000); // pauses of 1 s and 2 s between the attempts
    await expect(page.locator("#status.err")).toContainText("Azure DevOps answered with a web page instead of data (HTTP 203");
    await expect(page.locator("#status")).not.toContainText("JSON");
    await expect(page.locator("#reload-page")).toBeVisible();
  });

  test("API errors are shown to the user", async ({ page }) => {
    await page.goto("hub.html?scenario=error");
    await expect(page.locator("#status .spinner")).toHaveCount(0);
    await expect(page.locator("#status.err")).toContainText("VS402337");
    await expect(page.locator("#result")).toBeHidden();
    await expect(page.locator("#status")).toContainText("Reload the page to try again.");
    await expect(page.locator("#reload-page")).toBeVisible();
  });
});
