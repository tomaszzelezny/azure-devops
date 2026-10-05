import { test as base, expect, type Page } from "@playwright/test";

/** Shape of window.__mock (dev/mock/state.ts) as seen from tests. */
export interface MockCall { method: string; path: string; body?: any }

/** Fails the test on uncaught page errors and on console errors (the mock logs unhandled API calls there). */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    await use(errors);
    expect(errors, "no errors in the page").toEqual([]);
  }, { auto: true }],
});

export { expect };

export const calls = (page: Page): Promise<MockCall[]> => page.evaluate(() => (window as any).__mock.calls);

/** The last WIQL query the page sent. */
export async function lastWiql(page: Page): Promise<string> {
  const all = (await calls(page)).filter((c) => c.path.includes("/_apis/wit/wiql"));
  expect(all.length, "a WIQL query was sent").toBeGreaterThan(0);
  return all[all.length - 1].body.query;
}

/** Values of a WIQL "IN (…)" clause, e.g. inClause(q, "System.State"). */
export function inClause(query: string, field: string): string[] {
  const m = query.match(new RegExp(`\\[${field.replace(".", "\\.")}\\] IN \\(([^)]*)\\)`));
  return m ? [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'")) : [];
}

export async function openHub(page: Page, query = "") {
  await page.goto(`hub.html${query ? `?${query}` : ""}`);
  await expect(page.locator("#status")).toBeHidden();
}

/** Row of the hub's "Longest in current state" table: { inState, age } in days, or undefined when absent. */
export async function hubRow(page: Page, id: number) {
  const row = page.locator("#table tr", { has: page.locator(`a[data-id="${id}"]`) });
  if (!(await row.count())) return undefined;
  const cells = await row.locator("td").allTextContents();
  return { title: cells[1], type: cells[2], state: cells[3], inState: Number(cells[4].replace(/\D/g, "")), age: Number(cells[5].replace(/\D/g, "")) };
}

export const chipLabels = (page: Page, id: string) =>
  page.locator(`#${id} label`).evaluateAll((ls) => ls.map((l) => `${l.textContent}${(l.querySelector("input") as HTMLInputElement).checked ? "" : " (off)"}`));

export const dots = (page: Page) => page.locator("#chart circle.dot");
