import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveStates, effectiveTypes, escapeWiql, niceMax, scanHistory, seriesFor, startStates, summary, takeaway, ticks, toPoints,
} from "../src/core/compute.ts";
import { DEFAULT_SETTINGS, type ProjectMeta, type WipItem } from "../src/core/types.ts";

const meta: ProjectMeta = {
  types: [
    { name: "Bug", states: [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Resolved", category: "Resolved" }, { name: "Closed", category: "Completed" }] },
    { name: "Task", states: [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Closed", category: "Completed" }] },
    { name: "User Story", states: [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "OnHold", category: "InProgress" }, { name: "Resolved", category: "Resolved" }, { name: "Closed", category: "Completed" }] },
  ],
  defaultTypes: ["User Story", "Bug"],
};

const item = (id: number, state: string, started: string, changed: string): WipItem => ({
  id, title: `#${id}`, type: "User Story", state, assignedTo: "",
  createdDate: new Date("2020-01-01"), startedDate: new Date(started), stateChangeDate: new Date(changed),
});

test("defaults pick Requirement + Bug types and InProgress/Resolved states in workflow order", () => {
  assert.deepEqual(effectiveTypes(DEFAULT_SETTINGS, meta), ["User Story", "Bug"]);
  assert.deepEqual(effectiveStates(DEFAULT_SETTINGS, meta), ["Active", "OnHold", "Resolved"]);
});

test("explicit settings win, unknown names are ignored", () => {
  const s = { ...DEFAULT_SETTINGS, types: ["Task", "Epic"], states: ["Active", "Gone"] };
  assert.deepEqual(effectiveTypes(s, meta), ["Task"]);
  assert.deepEqual(effectiveStates(s, meta), ["Active"]);
});

test("points measure age since work started and time in the current state", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const [p] = toPoints([item(1, "Active", "2025-10-01T00:00:00Z", "2026-09-01T00:00:00Z")], now);
  assert.equal(Math.round(p.age), 365);
  assert.equal(Math.round(p.inState), 30);
});

test("summary and takeaway", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const pts = toPoints([
    item(1, "Active", "2023-01-01", "2024-01-01"),
    item(2, "Active", "2026-01-01", "2026-09-20"),
    item(3, "OnHold", "2026-01-01", "2026-03-01"),
  ], now);
  assert.deepEqual(summary(pts, 365), { stuck: 1, fresh: 1, total: 3 });
  assert.equal(takeaway(pts, 365), "<b>1 of 3</b> items have been in the same state for more than 1 year. Only 1 item changed state in the last 30 days.");
  assert.deepEqual(seriesFor(["Active", "OnHold"], pts).map((s) => [s.name, s.color, s.count]), [["Active", 0, 2], ["OnHold", 1, 1]]);
});

test("start states are the InProgress and Resolved states of each type", () => {
  const s = startStates(meta);
  assert.deepEqual([...s.get("User Story")!], ["Active", "OnHold", "Resolved"]);
  assert.deepEqual([...s.get("Task")!], ["Active"]);
});

test("history scan finds the first start and the last state change", () => {
  const started = new Set(["Active", "Resolved"]);
  const h = [
    { state: "New", date: "2024-01-01T00:00:00Z" },
    { date: "2024-01-05T00:00:00Z" }, // field edit, no state change
    { state: "Active", date: "2024-02-01T00:00:00Z" },
    { state: "New", date: "2024-03-01T00:00:00Z" },
    { state: "Active", date: "2024-04-01T00:00:00Z" },
    { state: "Resolved", date: "2024-05-01T00:00:00Z" },
  ];
  const r = scanHistory(h, started);
  assert.equal(r.firstStart?.toISOString(), "2024-02-01T00:00:00.000Z");
  assert.equal(r.lastChange?.toISOString(), "2024-05-01T00:00:00.000Z");
  assert.equal(scanHistory([{ state: "New", date: "2024-01-01" }], started).firstStart, undefined);
});

test("helpers", () => {
  assert.equal(escapeWiql("O'Brien"), "'O''Brien'");
  assert.equal(niceMax(730), 1000);
  assert.equal(niceMax(410), 500);
  assert.deepEqual(ticks(1000, 4), [0, 250, 500, 750, 1000]);
  assert.equal(takeaway([], 365), "No open work items in the selected states.");
});
