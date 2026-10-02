import { niceMax, thresholdLabel, ticks, type AgingPoint, type StateSeries } from "./compute.ts";

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

const fmt = (v: number) => Math.round(v).toLocaleString("pl-PL");

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface ChartOptions {
  height: number;
  thresholdDays: number;
  /** Smaller margins and fonts for dashboard widgets. */
  compact?: boolean;
  onOpen?: (id: number) => void;
}

let tip: HTMLDivElement | undefined;

function tooltip(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tip";
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

function showTip(ev: MouseEvent, html: string) {
  const t = tooltip();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}

const hideTip = () => { if (tip) tip.hidden = true; };

/**
 * Aging WIP scatter: x = age since creation, y = days in the current state.
 * Dots on the diagonal have not changed state since they were created.
 */
export function renderAgingChart(host: HTMLElement, points: AgingPoint[], series: StateSeries[], opts: ChartOptions): void {
  host.innerHTML = "";
  hideTip();
  const W = Math.max(260, host.clientWidth);
  const H = Math.max(160, opts.height);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": "Aging WIP" }, host);

  const c = opts.compact;
  const ml = c ? 40 : 58, mr = 10, mt = 10, mb = c ? 30 : 38;
  const fs = c ? 10 : 11;
  const color = new Map(series.map((s) => [s.name, `var(--c${s.color})`]));
  const P = points.filter((p) => color.has(p.item.state));

  const m = niceMax(Math.max(opts.thresholdDays * 1.1, ...P.map((p) => p.age), 30) * 1.02);
  const x = (v: number) => ml + (v / m) * (W - ml - mr);
  const y = (v: number) => H - mb - (v / m) * (H - mt - mb);
  const tk = ticks(m, c ? 3 : 4);

  const grid = el("g", { class: "grid" }, svg);
  const ax = el("g", { class: "axis", "font-size": fs }, svg);
  for (const v of tk) {
    el("line", { x1: ml, x2: W - mr, y1: y(v), y2: y(v) }, grid);
    el("text", { x: ml - 6, y: y(v) + 4, "text-anchor": "end" }, ax).textContent = fmt(v);
    el("text", { x: x(v), y: H - mb + 15, "text-anchor": "middle" }, ax).textContent = fmt(v);
  }
  el("text", { x: (ml + W - mr) / 2, y: H - 3, "text-anchor": "middle", class: "label", "font-size": fs }, svg)
    .textContent = "wiek elementu (dni od utworzenia)";
  const cy = (mt + H - mb) / 2;
  el("text", { x: 10, y: cy, transform: `rotate(-90 10 ${cy})`, "text-anchor": "middle", class: "label", "font-size": fs }, svg)
    .textContent = "dni w obecnym stanie";

  el("line", { x1: x(0), y1: y(0), x2: x(m), y2: y(m), class: "diag" }, svg);
  const thr = opts.thresholdDays;
  if (thr < m) {
    el("line", { x1: ml, x2: W - mr, y1: y(thr), y2: y(thr), class: "thr" }, svg);
    el("text", { x: W - mr - 4, y: y(thr) - 5, "text-anchor": "end", class: "thr-label", "font-size": fs }, svg)
      .textContent = `${thresholdLabel(thr)} w tym samym stanie`;
  }
  el("line", { x1: ml, x2: W - mr, y1: y(0), y2: y(0), class: "base" }, svg);

  const dots = el("g", {}, svg);
  const r = c ? 3.5 : 4.5;
  const placed = P.map((p) => {
    const px = x(p.age), py = y(p.inState);
    el("circle", { cx: px, cy: py, r, fill: color.get(p.item.state)!, class: "dot" }, dots);
    return { p, px, py };
  });

  // One transparent hit area with nearest-dot lookup: cheaper than a listener per dot and easier to hit.
  const hit = el("rect", { x: ml, y: mt, width: W - ml - mr, height: H - mt - mb, fill: "transparent" }, svg);
  let current: AgingPoint | undefined;
  hit.addEventListener("mousemove", (ev) => {
    const b = svg.getBoundingClientRect();
    const mx = ((ev.clientX - b.left) * W) / b.width, my = ((ev.clientY - b.top) * H) / b.height;
    let best: (typeof placed)[number] | undefined, bd = 14 ** 2;
    for (const d of placed) {
      const dd = (d.px - mx) ** 2 + (d.py - my) ** 2;
      if (dd < bd) { bd = dd; best = d; }
    }
    current = best?.p;
    hit.style.cursor = current && opts.onOpen ? "pointer" : "default";
    if (!best) return hideTip();
    const it = best.p.item;
    const row = (k: string, v: string, sw?: string) =>
      `<div class="row">${sw ? `<i style="background:${sw}"></i>` : "<i></i>"}<span>${k}</span><b>${esc(v)}</b></div>`;
    showTip(ev,
      `<div class="t"><span class="mono">#${it.id}</span> ${esc(it.title)}</div>` +
      row("Typ", it.type) +
      row("Stan", it.state, color.get(it.state)) +
      row("Wiek", `${fmt(best.p.age)} dni`) +
      row("W obecnym stanie", `${fmt(best.p.inState)} dni`) +
      (it.assignedTo ? row("Przypisany", it.assignedTo) : ""));
  });
  hit.addEventListener("mouseleave", () => { current = undefined; hideTip(); });
  hit.addEventListener("click", () => { if (current && opts.onOpen) opts.onOpen(current.item.id); });
}

/** Legend with counts; clicking a state toggles it (when onToggle is given). */
export function renderLegend(host: HTMLElement, series: StateSeries[], hidden: Set<string>, onToggle?: (state: string) => void): void {
  host.innerHTML = "";
  for (const s of series) {
    const b = document.createElement(onToggle ? "button" : "span");
    b.className = "lg" + (hidden.has(s.name) ? " off" : "");
    b.innerHTML = `<i style="background:var(--c${s.color})"></i>${esc(s.name)} <span class="n">${s.count}</span>`;
    if (onToggle) {
      b.setAttribute("aria-pressed", String(!hidden.has(s.name)));
      b.title = "Pokaż / ukryj";
      b.addEventListener("click", () => onToggle(s.name));
    }
    host.appendChild(b);
  }
}
