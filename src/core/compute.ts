import type { AgingSettings, ProjectMeta, StateMeta, WipItem } from "./types.ts";

const DAY = 86_400_000;

export const WIP_CATEGORIES = ["InProgress", "Resolved"];

export interface AgingPoint {
  item: WipItem;
  /** Days since work on the item started. */
  age: number;
  /** Days since the item entered its current state. */
  inState: number;
}

export interface StateSeries {
  name: string;
  /** Index into the categorical palette (--c0 … --c7). */
  color: number;
  count: number;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / DAY);
}

export function toPoints(items: WipItem[], now: Date): AgingPoint[] {
  return items.map((item) => ({
    item,
    age: daysBetween(item.startedDate, now),
    inState: daysBetween(item.stateChangeDate, now),
  }));
}

/** Per work item type, the states that count as "work started" (InProgress and Resolved categories). */
export function startStates(meta: ProjectMeta): Map<string, Set<string>> {
  return new Map(meta.types.map((t) => [t.name, new Set(t.states.filter((s) => WIP_CATEGORIES.includes(s.category)).map((s) => s.name))]));
}

/** One entry of a work item's update history, reduced to what we need. */
export interface StateUpdate {
  /** New value of System.State, when this update changed the state. */
  state?: string;
  /** System.ChangedDate of the update. */
  date?: string;
}

/** First time the item entered a started state, and the last state change, from its history (oldest first). */
export function scanHistory(updates: StateUpdate[], started: Set<string>): { firstStart?: Date; lastChange?: Date } {
  let firstStart: Date | undefined, lastChange: Date | undefined;
  for (const u of updates) {
    if (!u.state || !u.date) continue;
    const d = new Date(u.date);
    if (!firstStart && started.has(u.state)) firstStart = d;
    lastChange = d;
  }
  return { firstStart, lastChange };
}

export function effectiveTypes(settings: AgingSettings, meta: ProjectMeta): string[] {
  const known = new Set(meta.types.map((t) => t.name));
  const picked = settings.types.filter((t) => known.has(t));
  return picked.length ? picked : meta.defaultTypes.filter((t) => known.has(t));
}

/**
 * States of the given types in workflow order, de-duplicated by name.
 * The default types (Requirement, then Bug) go first whatever order the types were picked in,
 * so the state order, and with it the colours, stays the same when another type is added.
 */
export function statesOf(types: string[], meta: ProjectMeta): StateMeta[] {
  const rank = (t: string) => { const i = meta.defaultTypes.indexOf(t); return i < 0 ? meta.defaultTypes.length : i; };
  const ordered = [...types].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const seen = new Map<string, StateMeta>();
  for (const name of ordered) {
    const t = meta.types.find((x) => x.name === name);
    for (const s of t?.states ?? []) if (!seen.has(s.name)) seen.set(s.name, s);
  }
  return [...seen.values()];
}

/** The only states the chart offers: InProgress and Resolved categories, in workflow order. */
export function wipStatesOf(types: string[], meta: ProjectMeta): string[] {
  return statesOf(types, meta).filter((s) => WIP_CATEGORIES.includes(s.category)).map((s) => s.name);
}

export function effectiveStates(settings: AgingSettings, meta: ProjectMeta): string[] {
  const all = wipStatesOf(effectiveTypes(settings, meta), meta);
  // Saved selections may name states from other categories (older versions offered them); drop those.
  const picked = settings.states.filter((s) => all.includes(s));
  return picked.length ? picked : all;
}

/** One series per selected state, coloured in workflow order so colours stay stable across refreshes. */
export function seriesFor(states: string[], points: AgingPoint[]): StateSeries[] {
  return states.map((name, i) => ({
    name,
    color: i % 8,
    count: points.filter((p) => p.item.state === name).length,
  }));
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  const i = (v.length - 1) * p;
  const lo = Math.floor(i);
  return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo);
}

/** Round an axis maximum up to 1, 2, 2.5 or 5 × 10^n. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= v) return m * e;
  return 10 * e;
}

export function ticks(max: number, count: number): number[] {
  const step = niceMax(max / count);
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export function escapeWiql(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function thresholdLabel(days: number): string {
  if (days === 365) return "1 year";
  if (days === 730) return "2 years";
  if (days === 180) return "6 months";
  return `${days} days`;
}

export function summary(points: AgingPoint[], thresholdDays: number): { stuck: number; fresh: number; total: number } {
  return {
    stuck: points.filter((p) => p.inState > thresholdDays).length,
    fresh: points.filter((p) => p.inState <= 30).length,
    total: points.length,
  };
}

export const NO_ITEMS = "No open work items in the selected states.";

export function takeaway(points: AgingPoint[], thresholdDays: number): string {
  const { stuck, fresh, total } = summary(points, thresholdDays);
  if (!total) return NO_ITEMS;
  const tail = fresh === 0 ? "None of them changed state in the last 30 days."
    : fresh === total ? "All of them changed state in the last 30 days."
    : `Only ${fresh} ${fresh === 1 ? "item" : "items"} changed state in the last 30 days.`;
  return `<b>${stuck} of ${total}</b> items have been in the same state for more than ${thresholdLabel(thresholdDays)}. ${tail}`;
}
