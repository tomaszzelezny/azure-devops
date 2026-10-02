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

/** Polish plural form: 1 element, 2–4 elementy, 5+ elementów (12–14 → elementów). */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10, h = n % 100;
  return d >= 2 && d <= 4 && !(h >= 12 && h <= 14) ? few : many;
}

export function thresholdLabel(days: number): string {
  if (days === 365) return "rok";
  if (days === 730) return "2 lata";
  if (days === 180) return "pół roku";
  return `${days} dni`;
}

export function summary(points: AgingPoint[], thresholdDays: number): { stuck: number; fresh: number; total: number } {
  return {
    stuck: points.filter((p) => p.inState > thresholdDays).length,
    fresh: points.filter((p) => p.inState <= 30).length,
    total: points.length,
  };
}

export function takeaway(points: AgingPoint[], thresholdDays: number): string {
  const { stuck, fresh, total } = summary(points, thresholdDays);
  if (!total) return "Brak otwartych elementów w wybranych stanach.";
  const verb = plural(fresh, "element zmienił", "elementy zmieniły", "elementów zmieniło");
  const tail = fresh === 0 ? "Żaden nie zmienił stanu w ostatnich 30 dniach."
    : fresh === total ? "Wszystkie zmieniły stan w ostatnich 30 dniach."
    : `Tylko ${fresh} ${verb} stan w ostatnich 30 dniach.`;
  return `<b>${stuck} z ${total}</b> elementów stoi w tym samym stanie ponad ${thresholdLabel(thresholdDays)}. ${tail}`;
}
