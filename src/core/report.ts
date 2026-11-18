/**
 * The downloadable report: one image with a header (filters, date), summary numbers, the chart
 * and two tables. Built as a standalone SVG string (pure, unit-tested) and turned into a PNG in the
 * browser by toPng(). An SVG drawn as an image sees no page CSS, so colours come in resolved.
 */
import { esc } from "./chart.ts";
import type { ReportStats } from "./compute.ts";
import type { ReportTexts } from "./i18n.ts";

/** Colour tokens of styles.css, resolved for the current theme. */
export const COLOR_TOKENS = ["page", "surface", "ink", "ink-2", "muted", "grid", "axis", "line", "crit", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"] as const;
export type Colors = Record<(typeof COLOR_TOKENS)[number], string>;

export interface ReportInput {
  texts: ReportTexts;
  locale: string;
  project: string;
  /** Team name; empty for the entire project. */
  team: string;
  types: string[];
  /** States shown on the chart (hidden legend entries left out). */
  states: string[];
  thresholdDays: number;
  includeCurrentIteration: boolean;
  now: Date;
  version: string;
  stats: ReportStats;
  /** The chart, rendered at CHART_WIDTH × chartHeight. */
  chart: { markup: string; height: number };
  colors: Colors;
}

export const REPORT_WIDTH = 1184;
const P = 32;
const INNER = REPORT_WIDTH - 2 * P;
/** Width to render the chart at, so it fits its box in the report. */
export const CHART_WIDTH = INNER - 28;
const FONT = `"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", sans-serif`;
const MONO = `"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;

// Same rules as the chart section of static/styles.css.
const CHART_CSS = `
.grid line{stroke:var(--grid)} .axis text{fill:var(--muted);font-variant-numeric:tabular-nums} .label{fill:var(--muted)}
.diag{stroke:var(--axis);stroke-dasharray:3 3} .base{stroke:var(--axis)} .thr{stroke:var(--crit);opacity:.6}
.thr-label{fill:var(--crit);font-weight:600;paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}
.dot{stroke:var(--surface);stroke-width:1.5} .stack-ring{fill:none;stroke-width:1.5}
.stack{fill:var(--ink-2);font-weight:600;paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}`;

/** Splits text into lines of at most `max` characters, at spaces. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    if (line && (line + " " + w).length > max) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function reportSvg(r: ReportInput): { svg: string; width: number; height: number } {
  const T = r.texts;
  const n = (v: number) => Math.round(v).toLocaleString(r.locale);
  const thr = T.thresholdName(r.thresholdDays);
  const s = r.stats;
  const parts: string[] = [];
  const text = (x: number, y: number, body: string, attrs = "") => parts.push(`<text x="${x}" y="${y}" ${attrs}>${body}</text>`);
  const rect = (x: number, y: number, w: number, h: number) =>
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="none" stroke="var(--line)"/>`);
  const hline = (x1: number, x2: number, y: number) => parts.push(`<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="var(--line)"/>`);
  const dot = (x: number, y: number, color: number) => parts.push(`<circle cx="${x}" cy="${y}" r="4.5" fill="var(--c${color})"/>`);
  const colorOf = new Map(s.byState.map((b) => [b.name, b.color]));

  // Header: title; scope (project, team, threshold, iteration); filters (types, states). The date goes in the footer.
  let y = P + 22;
  text(P, y, esc(T.title), `font-size="22" font-weight="600" fill="var(--ink)"`);
  const kv = (k: string, v: string) => `<tspan fill="var(--ink-2)">${esc(k)}: </tspan><tspan fill="var(--ink)" font-weight="600">${esc(clip(v, 70))}</tspan>`;
  const sep = `<tspan fill="var(--muted)">   ·   </tspan>`;
  const iteration = `<tspan fill="var(--ink-2)">${esc(r.includeCurrentIteration ? T.currentIncluded : T.currentExcluded)}</tspan>`;
  text(P, y + 26, [kv(T.project, r.project), kv(T.team, r.team || T.entireProject), kv(T.threshold, thr), iteration].join(sep), `font-size="13" xml:space="preserve"`);
  text(P, y + 46, [kv(T.types, r.types.join(", ")), kv(T.states, r.states.join(", "))].join(sep), `font-size="13" xml:space="preserve"`);
  y += 62;
  hline(P, REPORT_WIDTH - P, y);

  const gap = 10, tw = (INNER - 5 * gap) / 6, th = 104;
  // Summary tiles, grouped by measure: tiles 2–5 count days since work started, 6 days in the current state.
  y += 16;
  const groupCaption = (from: number, to: number, label: string) => {
    const x1 = P + from * (tw + gap), x2 = P + (to + 1) * (tw + gap) - gap;
    text(x1, y + 10, esc(label), `font-size="11.5" font-weight="600" fill="var(--muted)" letter-spacing=".3"`);
    parts.push(`<line x1="${x1}" x2="${x2}" y1="${y + 17}" y2="${y + 17}" stroke="var(--axis)"/>`);
  };

  const ofTotal = (v: number) => `${n(v)}<tspan font-size="13" font-weight="400" fill="var(--ink-2)"> ${esc(T.of)} ${n(s.total)}</tspan>`;
  const tiles: { k: string; v: string; u: string; crit?: boolean }[] = [
    { k: T.items, v: n(s.total), u: "" },
    { k: T.medianAge, v: n(s.medianAge), u: T.days },
    { k: T.p85Age, v: n(s.p85Age), u: T.days },
    { k: T.oldest, v: s.oldest ? n(s.oldest.age) : "–", u: s.oldest ? `${T.days} · #${s.oldest.item.id} · ${T.oldestInState.replace("{n}", n(s.oldest.inState))}` : "" },
    { k: T.over, v: ofTotal(s.overThreshold), u: T.overNote.replace("{t}", thr), crit: true },
    { k: T.fresh, v: ofTotal(s.fresh), u: "" },
  ];
  groupCaption(1, 4, T.groupSinceStart);
  groupCaption(5, 5, T.groupInState);
  y += 26;
  tiles.forEach((t, i) => {
    const x = P + i * (tw + gap);
    rect(x, y, tw, th);
    const kl = wrap(t.k, 26);
    kl.forEach((l, j) => text(x + 12, y + 20 + j * 14, esc(l), `font-size="12" fill="var(--ink-2)"`));
    text(x + 12, y + 68, t.v.includes("<tspan") ? t.v : esc(t.v),
      `font-size="26" font-weight="600" fill="${t.crit ? "var(--crit)" : "var(--ink)"}"`);
    wrap(t.u, 30).slice(0, 2).forEach((l, j) => text(x + 12, y + 86 + j * 13, esc(l), `font-size="11.5" fill="var(--muted)"`));
  });
  y += th + 16;

  // Chart with its legend.
  const ch = r.chart.height;
  rect(P, y, INNER, ch + 46);
  let lx = P + 16;
  for (const b of s.byState) {
    dot(lx + 4, y + 20, b.color);
    const label = `${b.name} `;
    text(lx + 14, y + 24, `${esc(label)}<tspan fill="var(--muted)">${n(b.count)}</tspan>`, `font-size="12" fill="var(--ink-2)"`);
    lx += 14 + (label.length + String(b.count).length) * 6.6 + 18;
  }
  parts.push(`<svg x="${P + 14}" y="${y + 34}" width="${CHART_WIDTH}" height="${ch}" viewBox="0 0 ${CHART_WIDTH} ${ch}" overflow="visible">${r.chart.markup}</svg>`);
  y += ch + 46 + 26;

  // Tables: by state (left), started longest ago (right).
  const lw = Math.round(INNER * 0.44), rx = P + lw + 24, rw = INNER - lw - 24;
  const table = (x: number, w: number, title: string, cols: { h: string; w: number; num?: boolean }[], rows: { cells: string[]; color?: number; mono0?: boolean }[]) => {
    let ty = y;
    text(x, ty, esc(title), `font-size="14" font-weight="600" fill="var(--ink)"`);
    ty += 24;
    const colX: number[] = [];
    let cx = x;
    for (const c of cols) { colX.push(cx); cx += c.w * w; }
    cols.forEach((c, i) => text(c.num ? colX[i] + c.w * w - 6 : colX[i] + 6, ty, esc(c.h),
      `font-size="12.5" font-weight="600" fill="var(--ink-2)"${c.num ? ` text-anchor="end"` : ""}`));
    ty += 8;
    hline(x, x + w, ty);
    for (const row of rows) {
      ty += 24;
      row.cells.forEach((v, i) => {
        const c = cols[i];
        const colorCol = row.color !== undefined && i === (row.mono0 ? 2 : 0);
        if (colorCol) dot(colX[i] + 10, ty - 4, row.color!);
        const tx = c.num ? colX[i] + c.w * w - 6 : colX[i] + (colorCol ? 20 : 6);
        text(tx, ty, esc(v), `font-size="12.5" fill="var(--ink)"${c.num ? ` text-anchor="end"` : ""}${row.mono0 && i === 0 ? ` font-family='${MONO}'` : ""}`);
      });
      hline(x, x + w, ty + 9);
      ty += 1;
    }
    return ty + 9;
  };
  const leftEnd = table(P, lw, T.byState,
    [{ h: T.state, w: 0.22 }, { h: T.count, w: 0.14, num: true }, { h: T.medianInState, w: 0.25, num: true }, { h: T.p85InState, w: 0.18, num: true }, { h: T.maxInState, w: 0.21, num: true }],
    s.byState.map((b) => ({ cells: [b.name, n(b.count), b.count ? n(b.medianInState) : "–", b.count ? n(b.p85InState) : "–", b.count ? n(b.maxInState) : "–"], color: b.color })));
  const rightEnd = table(rx, rw, T.longest,
    [{ h: T.id, w: 0.12 }, { h: T.workItem, w: 0.42 }, { h: T.state, w: 0.2 }, { h: T.age, w: 0.13, num: true }, { h: T.inState, w: 0.13, num: true }],
    s.longest.map((p) => ({ cells: [`#${p.item.id}`, clip(p.item.title, 38), p.item.state, n(p.age), n(p.inState)], color: colorOf.get(p.item.state) ?? 0, mono0: true })));
  y = Math.max(leftEnd, rightEnd) + 28;

  const date = r.now.toLocaleDateString(r.locale, { day: "numeric", month: "long", year: "numeric" }) + ", " +
    r.now.toLocaleTimeString(r.locale, { hour: "2-digit", minute: "2-digit" });
  text(P, y, `<tspan fill="var(--ink-2)">${esc(T.asOf)}: </tspan><tspan fill="var(--ink)" font-weight="600">${esc(date)}</tspan>`, `font-size="12.5" xml:space="preserve"`);
  text(REPORT_WIDTH - P, y, esc(`${T.generated} · v${r.version}`), `font-size="11.5" fill="var(--muted)" text-anchor="end"`);
  const height = y + 20;

  const vars = Object.entries(r.colors).map(([k, v]) => `--${k}:${v}`).join(";");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${REPORT_WIDTH}" height="${height}" viewBox="0 0 ${REPORT_WIDTH} ${height}" ` +
    `style="${esc(vars)}" font-family='${FONT}'>` +
    `<style>${CHART_CSS}</style>` +
    `<rect width="100%" height="100%" fill="var(--surface)"/>` +
    parts.join("") + `</svg>`;
  return { svg, width: REPORT_WIDTH, height };
}

/** Draws the report SVG onto a canvas at `scale` and returns it as a PNG. */
export async function toPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"));
}

/** Saves a blob as a file through a temporary link. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File name: aging-wip-<project>-<yyyy-mm-dd>.png */
export function reportFileName(project: string, now: Date): string {
  const slug = project.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/gi, "l").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `aging-wip-${slug}-${d}.png`;
}
