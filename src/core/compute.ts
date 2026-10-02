import type { AgingSettings, ProjectMeta, StateMeta, WipItem } from "./types.ts";

const DAY = 86_400_000;

export const WIP_CATEGORIES = ["InProgress", "Resolved"];

export interface AgingPoint {
  item: WipItem;
  /** Days since the item was created. */
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
    age: daysBetween(item.createdDate, now),
    inState: daysBetween(item.stateChangeDate, now),
  }));
}

export function effectiveTypes(settings: AgingSettings, meta: ProjectMeta): string[] {
  const known = new Set(meta.types.map((t) => t.name));
  const picked = settings.types.filter((t) => known.has(t));
  return picked.length ? picked : meta.defaultTypes.filter((t) => known.has(t));
}

/** States of the given types in workflow order, de-duplicated by name. */
export function statesOf(types: string[], meta: ProjectMeta): StateMeta[] {
  const seen = new Map<string, StateMeta>();
  for (const name of types) {
    const t = meta.types.find((x) => x.name === name);
    for (const s of t?.states ?? []) if (!seen.has(s.name)) seen.set(s.name, s);
  }
  return [...seen.values()];
}

export function effectiveStates(settings: AgingSettings, meta: ProjectMeta): string[] {
  const all = statesOf(effectiveTypes(settings, meta), meta);
  const known = new Set(all.map((s) => s.name));
  const picked = settings.states.filter((s) => known.has(s));
  return picked.length ? picked : all.filter((s) => WIP_CATEGORIES.includes(s.category)).map((s) => s.name);
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
