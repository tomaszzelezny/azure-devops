import { niceMax, stackPoints, thresholdLabel, ticks, type AgingPoint, type StateSeries } from "./compute.ts";

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

const fmt = (v: number) => Math.round(v).toLocaleString();

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

/** Clicked stack: a pinned list of its items, each one opens on click. Closes on Escape or a click elsewhere. */
let menu: HTMLDivElement | undefined;

function closeMenu() {
  if (!menu) return;
  menu.remove();
  menu = undefined;
  document.removeEventListener("mousedown", onOutside, true);
  document.removeEventListener("keydown", onEscape, true);
}

function onOutside(ev: MouseEvent) { if (menu && !menu.contains(ev.target as Node)) closeMenu(); }
function onEscape(ev: KeyboardEvent) { if (ev.key === "Escape") closeMenu(); }

function openMenu(ev: MouseEvent, html: string, onPick: (id: number) => void) {
  closeMenu();
  hideTip();
  menu = document.createElement("div");
  menu.className = "tip menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = html;
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  let x = ev.clientX + 6, y = ev.clientY + 6;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 6;
  if (y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;
  menu.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-id]");
    if (!b) return;
    closeMenu();
    onPick(Number(b.dataset.id));
  });
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onEscape, true);
}

/**
 * Aging WIP scatter: x = age since work started, y = days in the current state.
 * Dots on the diagonal have not changed state since work started.
 */
export function renderAgingChart(host: HTMLElement, points: AgingPoint[], series: StateSeries[], opts: ChartOptions): void {
  host.innerHTML = "";
  hideTip();
  closeMenu();
  const W = Math.max(260, host.clientWidth);
  const H = Math.max(160, opts.height);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": "Aging WIP" }, host);

  const c = opts.compact;
  const ml = c ? 48 : 58, mr = 10, mt = 10, mb = c ? 30 : 38;
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
    .textContent = "age (days since in progress)";
  const cy = (mt + H - mb) / 2;
  el("text", { x: 9, y: cy, transform: `rotate(-90 9 ${cy})`, "text-anchor": "middle", class: "label", "font-size": fs }, svg)
    .textContent = "days in current state";

  el("line", { x1: x(0), y1: y(0), x2: x(m), y2: y(m), class: "diag" }, svg);
  const thr = opts.thresholdDays;
  if (thr < m) {
    el("line", { x1: ml, x2: W - mr, y1: y(thr), y2: y(thr), class: "thr" }, svg);
    el("text", { x: W - mr - 4, y: y(thr) - 5, "text-anchor": "end", class: "thr-label", "font-size": fs }, svg)
      .textContent = `${thresholdLabel(thr)} in the same state`;
  }
  el("line", { x1: ml, x2: W - mr, y1: y(0), y2: y(0), class: "base" }, svg);

  // Items on the same spot share one position; a count next to the dot says how many it hides.
  const dots = el("g", {}, svg);
  const r = c ? 3.5 : 4.5;
  const placed = stackPoints(P).map((g) => {
    const px = x(Math.round(g[0].age)), py = y(Math.round(g[0].inState));
    for (const p of g) el("circle", { cx: px, cy: py, r, fill: color.get(p.item.state)!, class: "dot" }, dots);
    if (g.length > 1) {
      el("circle", { cx: px, cy: py, r: r + 2.5, class: "stack-ring", stroke: color.get(g[0].item.state)! }, dots);
      el("text", { x: px + r + 4, y: py - r, class: "stack", "font-size": fs }, dots).textContent = `×${g.length}`;
    }
    return { g, px, py };
  });

  // One transparent hit area with nearest-dot lookup: cheaper than a listener per dot and easier to hit.
  const hit = el("rect", { x: ml, y: mt, width: W - ml - mr, height: H - mt - mb, fill: "transparent" }, svg);
  type Placed = (typeof placed)[number];
  const nearest = (ev: MouseEvent): Placed | undefined => {
    const b = svg.getBoundingClientRect();
    const mx = ((ev.clientX - b.left) * W) / b.width, my = ((ev.clientY - b.top) * H) / b.height;
    let best: Placed | undefined, bd = 14 ** 2;
    for (const d of placed) {
      const dd = (d.px - mx) ** 2 + (d.py - my) ** 2;
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  };
  const row = (k: string, v: string, sw?: string) =>
    `<div class="row">${sw ? `<i style="background:${sw}"></i>` : "<i></i>"}<span>${k}</span><b>${esc(v)}</b></div>`;
  const line = (it: AgingPoint["item"], tag: "div" | "button") =>
    `<${tag} class="it"${tag === "button" ? ` type="button" role="menuitem" data-id="${it.id}"` : ""}>` +
    `<i style="background:${color.get(it.state)}"></i><span class="mono">#${it.id}</span><span class="ti">${esc(it.title)}</span></${tag}>`;
  const head = (g: AgingPoint[]) =>
    `<div class="t">${g.length} items on this spot</div>` +
    row("Age", `${fmt(g[0].age)} days`) +
    row("In current state", `${fmt(g[0].inState)} days`);

  let current: Placed | undefined;
  hit.addEventListener("mousemove", (ev) => {
    const best = nearest(ev);
    current = best;
    hit.style.cursor = best && opts.onOpen ? "pointer" : "default";
    if (!best || menu) return hideTip();
    const g = best.g;
    if (g.length > 1) {
      const max = 12, more = g.length - max;
      return showTip(ev, head(g) +
        `<div class="items">` + g.slice(0, max).map((p) => line(p.item, "div")).join("") +
        (more > 0 ? `<div class="more">+${more} more</div>` : "") +
        (opts.onOpen ? `<div class="more">Click to pick an item</div>` : "") +
        `</div>`);
    }
    const it = g[0].item;
    showTip(ev,
      `<div class="t"><span class="mono">#${it.id}</span> ${esc(it.title)}</div>` +
      row("Type", it.type) +
      row("State", it.state, color.get(it.state)) +
      row("Age", `${fmt(g[0].age)} days`) +
      row("In current state", `${fmt(g[0].inState)} days`) +
      (it.assignedTo ? row("Assigned to", it.assignedTo) : ""));
  });
  hit.addEventListener("mouseleave", () => { current = undefined; hideTip(); });
  hit.addEventListener("click", (ev) => {
    const onOpen = opts.onOpen;
    if (!current || !onOpen) return;
    if (current.g.length === 1) return onOpen(current.g[0].item.id);
    // Overlapping dots: pin the list so each item can be clicked.
    openMenu(ev, head(current.g) + `<div class="items">${current.g.map((p) => line(p.item, "button")).join("")}</div>`, onOpen);
  });
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
      b.title = "Show / hide";
      b.addEventListener("click", () => onToggle(s.name));
    }
    host.appendChild(b);
  }
}
