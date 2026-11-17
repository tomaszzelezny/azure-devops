import { test } from "node:test";
import assert from "node:assert/strict";
import { reportStats, seriesFor, toPoints } from "../src/core/compute.ts";
import { LOCALE, REPORT_TEXTS, langOf } from "../src/core/i18n.ts";
import { COLOR_TOKENS, reportFileName, reportSvg, wrap, type Colors, type ReportInput } from "../src/core/report.ts";
import type { WipItem } from "../src/core/types.ts";

const now = new Date("2026-10-01T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const item = (id: number, state: string, age: number, inState: number, title = `Item ${id}`): WipItem => ({
  id, title, type: "User Story", state, assignedTo: "", iterationPath: "Demo",
  createdDate: daysAgo(age + 10), startedDate: daysAgo(age), stateChangeDate: daysAgo(inState),
});

const points = toPoints([
  item(1, "Active", 10, 5),
  item(2, "Active", 100, 100),
  item(3, "Resolved", 400, 380),
  item(4, "Active", 50, 20),
  item(5, "Resolved", 700, 30),
], now);
const series = seriesFor(["Active", "OnHold", "Resolved"], points);

test("report numbers: count, median and 85th percentile age, oldest, over threshold, fresh", () => {
  const s = reportStats(points, series, 365);
  assert.equal(s.total, 5);
  assert.equal(s.medianAge, 100);
  assert.equal(Math.round(s.p85Age), 520); // 400 + 0.4 × (700 − 400)
  assert.equal(s.oldest?.item.id, 5);
  assert.equal(s.overThreshold, 1);
  assert.equal(s.fresh, 3); // 5, 20 and 30 days in state
  assert.deepEqual(s.longest.map((p) => p.item.id), [3, 2, 5, 4, 1]);
});

test("per-state numbers count only the time in the current state, not the item's age", () => {
  // OnHold: 5, 20 and 100 days in the state; ages far larger and deliberately unordered.
  const onHold = toPoints([
    item(11, "OnHold", 900, 5),
    item(12, "OnHold", 400, 20),
    item(13, "OnHold", 650, 100),
  ], now);
  const b = reportStats(onHold, seriesFor(["OnHold"], onHold), 365).byState[0];
  assert.equal(b.count, 3);
  assert.equal(Math.round(b.medianInState), 20);
  assert.equal(Math.round(b.p85InState), 76); // 20 + 0.7 × (100 − 20)
  assert.equal(Math.round(b.maxInState), 100);

  // Changing only the ages leaves every per-state number as it was.
  const younger = toPoints([item(11, "OnHold", 6, 5), item(12, "OnHold", 30, 20), item(13, "OnHold", 101, 100)], now);
  const b2 = reportStats(younger, seriesFor(["OnHold"], younger), 365).byState[0];
  assert.deepEqual([b2.medianInState, b2.p85InState, b2.maxInState].map(Math.round), [20, 76, 100]);
});

test("per-state numbers for several states, including a state with no items", () => {
  const s = reportStats(points, series, 365);
  // Active: 5, 20, 100 days in state; Resolved: 30, 380.
  assert.deepEqual(s.byState.map((b) => [b.name, b.count, Math.round(b.medianInState), Math.round(b.p85InState), Math.round(b.maxInState)]), [
    ["Active", 3, 20, 76, 100],
    ["OnHold", 0, 0, 0, 0],
    ["Resolved", 2, 205, 328, 380],
  ]);
});

test("the summary tiles still use the age since work started", () => {
  const s = reportStats(points, series, 365);
  assert.equal(s.medianAge, 100);
  assert.equal(s.oldest?.item.id, 5);
});

test("report numbers with no items", () => {
  const s = reportStats([], seriesFor(["Active"], []), 365);
  assert.equal(s.total, 0);
  assert.equal(s.oldest, undefined);
  assert.deepEqual(s.longest, []);
});

test("the report language follows the Azure DevOps culture; English otherwise", () => {
  assert.equal(langOf("pl-PL"), "pl");
  assert.equal(langOf("pl"), "pl");
  assert.equal(langOf("en-US"), "en");
  assert.equal(langOf("de-DE"), "en");
  assert.equal(langOf(undefined), "en");
  assert.equal(langOf("plx"), "en");
});

test("every language has every text", () => {
  const keys = Object.keys(REPORT_TEXTS.en).sort();
  for (const [lang, t] of Object.entries(REPORT_TEXTS)) assert.deepEqual(Object.keys(t).sort(), keys, lang);
});

const colors = Object.fromEntries(COLOR_TOKENS.map((t) => [t, "#123456"])) as Colors;
const input = (lang: "en" | "pl", over: Partial<ReportInput> = {}): ReportInput => ({
  texts: REPORT_TEXTS[lang], locale: LOCALE[lang], project: "Demo", team: "", types: ["User Story"], states: ["Active", "Resolved"],
  thresholdDays: 365, includeCurrentIteration: false, now, version: "1.2.1",
  stats: reportStats(points, series, 365), chart: { markup: "<g id=chart></g>", height: 300 }, colors, ...over,
});

test("the report SVG is in the chosen language, with filters, numbers and the chart", () => {
  const pl = reportSvg(input("pl")).svg;
  for (const s of ["Mediana w stanie", "P85 w stanie", "Maks. w stanie", "Raport Aging WIP", "Cały projekt", "bez bieżącej iteracji", "Próg: ", "1 rok", "Mediana wieku", "Najdłużej w obecnym stanie", "<g id=chart></g>", "v1.2.1"]) {
    assert.ok(pl.includes(s), `PL report contains "${s}"`);
  }
  const en = reportSvg(input("en", { team: "Team A", includeCurrentIteration: true })).svg;
  for (const s of ["Median in state", "P85 in state", "Max in state", "Aging WIP report", "Team A", "current iteration included", "Median age", "more than 1 year in one state"]) {
    assert.ok(en.includes(s), `EN report contains "${s}"`);
  }
  assert.ok(!en.includes("Raport"));
  // The date of the data sits in the footer, after the tables.
  const footer = pl.slice(pl.indexOf("Dane z dnia"));
  assert.ok(pl.indexOf("Dane z dnia") > pl.indexOf("Najdłużej w obecnym stanie"));
  assert.ok(footer.includes("1 października 2026"), footer.slice(0, 300));
});

test("the report escapes work item titles and names", () => {
  const p = toPoints([item(9, "Active", 10, 10, `<script>&"x"`)], now);
  const { svg } = reportSvg(input("en", { project: "R&D", stats: reportStats(p, seriesFor(["Active"], p), 365) }));
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("R&#38;D"));
});

test("the report height grows with the chart", () => {
  const a = reportSvg(input("en")), b = reportSvg(input("en", { chart: { markup: "", height: 400 } }));
  assert.equal(b.height - a.height, 100);
  assert.ok(a.svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${a.width}" height="${a.height}"`));
});

test("helpers: word wrap and file name", () => {
  assert.deepEqual(wrap("Changed state in the last 30 days", 26), ["Changed state in the last", "30 days"]);
  assert.deepEqual(wrap("Items", 26), ["Items"]);
  assert.equal(reportFileName("My Project (EU)", new Date(2026, 10, 6)), "aging-wip-my-project-eu-2026-11-06.png");
  assert.equal(reportFileName("Żółw", new Date(2026, 0, 1)), "aging-wip-zolw-2026-01-01.png");
});
