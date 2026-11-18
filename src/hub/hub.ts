import * as SDK from "azure-devops-extension-sdk";
import { renderAgingChart, renderLegend, esc } from "../core/chart.ts";
import {
  effectiveStates, effectiveTypes, reportStats, seriesFor, wipStatesOf, takeaway, toPoints, type AgingPoint, type StateSeries,
} from "../core/compute.ts";
import { loadProjectMeta, loadTeams, loadWipItems } from "../core/data.ts";
import { openWorkItem } from "../core/navigation.ts";
import { watchTheme } from "../core/theme.ts";
import { checkboxes } from "../core/ui.ts";
import { LANG_NAMES, LANGS, LOCALE, REPORT_TEXTS, langOf, type Lang } from "../core/i18n.ts";
import { CHART_WIDTH, COLOR_TOKENS, download, reportFileName, reportSvg, toPng, type Colors } from "../core/report.ts";
import { DEFAULT_SETTINGS, type AgingSettings, type ProjectMeta, type WipItem } from "../core/types.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let project = { id: "", name: "" };
let meta: ProjectMeta;
let settings: AgingSettings = { ...DEFAULT_SETTINGS };
let items: WipItem[] = [];
const hidden = new Set<string>();
/** The load in progress; a newer one cancels it so stale requests do not compete with the current ones. */
let loading: AbortController | undefined;
/** Read the work item types again before the next load: after Refresh or a failed load (the process may have changed). */
let metaStale = false;
/** What the chart shows right now; the report is made from exactly this. */
let view: { points: AgingPoint[]; series: StateSeries[] } = { points: [], series: [] };
let teamName = "";

const storeKey = () => `aging-wip:${project.id}`;

function restore(): void {
  try {
    const raw = localStorage.getItem(storeKey());
    if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* storage unavailable: keep defaults */ }
}

function persist(): void {
  try { localStorage.setItem(storeKey(), JSON.stringify(settings)); } catch { /* ignore */ }
}

function renderControls(): void {
  const types = effectiveTypes(settings, meta);
  checkboxes($("types"), meta.types.map((t) => t.name), types, (next) => {
    settings = { ...settings, types: next, states: [] };
    persist(); renderControls(); void reload();
  });
  const stateNames = wipStatesOf(types, meta);
  checkboxes($("states"), stateNames, effectiveStates(settings, meta), (next) => {
    settings = { ...settings, states: next };
    persist(); renderControls(); void reload();
  });
  ($("threshold") as HTMLSelectElement).value = String(settings.thresholdDays);
  ($("current-iteration") as HTMLInputElement).checked = settings.includeCurrentIteration;
}

/** Without any progress for this long, the loader suggests reloading the page. */
const STALL_HINT_MS = 45_000;

/**
 * Shows a message instead of the result: a spinner while loading, red text for errors, nothing once loaded.
 * reloadHint adds a note that reloading the page should help, with a button that does it.
 */
function status(msg: string, err = false, reloadHint = false): void {
  const s = $("status");
  s.innerHTML = (err ? esc(msg) : `<span class="spinner" aria-hidden="true"></span>${esc(msg)}`) +
    (reloadHint
      ? `<span class="reload-hint">${err ? "Reload the page to try again." : "Azure DevOps is not answering. If this does not finish, reload the page."}</span>` +
        `<button class="btn" id="reload-page" type="button">↻ Reload page</button>`
      : "");
  s.className = err ? "status err" : "status loading";
  s.hidden = !msg;
  $("result").hidden = !!msg;
  if (msg) exportState(false);
}

async function reload(): Promise<void> {
  loading?.abort();
  const ctrl = loading = new AbortController();
  const current = () => loading === ctrl;
  let shown = "Loading work items…";
  let stalled: number | undefined;
  // Restarted on every bit of progress; fires only when the load sits still.
  const watch = () => {
    clearTimeout(stalled);
    stalled = window.setTimeout(() => { if (current()) status(shown, false, true); }, STALL_HINT_MS);
  };
  status(shown);
  watch();
  try {
    if (metaStale) {
      const m = await loadProjectMeta(project.id, ctrl.signal);
      if (!current()) return;
      meta = m;
      metaStale = false;
      renderControls();
    }
    const got = await loadWipItems(project.name, settings.teamId, effectiveTypes(settings, meta), effectiveStates(settings, meta), meta, {
      includeCurrentIteration: settings.includeCurrentIteration,
      onProgress: (done, total) => {
        if (!current()) return;
        status(shown = `Reading work item history… ${done} / ${total}`);
        watch();
      },
      signal: ctrl.signal,
    });
    if (!current()) return; // a newer request superseded this one
    loading = undefined;
    items = got;
    status("");
    draw();
  } catch (e) {
    if (!current()) return;
    loading = undefined;
    metaStale = true;
    status(e instanceof Error ? e.message : String(e), true, true);
  } finally {
    clearTimeout(stalled);
  }
}

function draw(): void {
  const states = effectiveStates(settings, meta);
  const all = toPoints(items, new Date());
  const series = seriesFor(states, all);
  const visible = series.filter((s) => !hidden.has(s.name));
  const shown = all.filter((p) => !hidden.has(p.item.state));

  renderLegend($("legend"), series, hidden, (name) => {
    if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
    draw();
  });
  const H = Math.round(Math.max(320, Math.min(600, innerHeight - 320)));
  renderAgingChart($("chart"), shown, visible, { height: H, thresholdDays: settings.thresholdDays, onOpen: openWorkItem });
  $("take").innerHTML = takeaway(shown, settings.thresholdDays);
  renderTable(shown);
  view = { points: shown, series: visible };
  exportState(shown.length > 0);
}

function exportState(enabled: boolean): void {
  const b = $("export") as HTMLButtonElement;
  b.disabled = !enabled;
  if (!enabled) closeLangMenu();
  b.title = enabled ? "Download the chart with its summary numbers as a PNG image" : "No work items to report";
}

/** The report: chart, numbers and filters as one PNG, in the user's Azure DevOps language. */
async function exportReport(lang: Lang): Promise<void> {
  const { points, series } = view;
  if (!points.length) return;
  const texts = REPORT_TEXTS[lang], locale = LOCALE[lang];
  const height = 420;
  const host = document.createElement("div");
  renderAgingChart(host, points, series, {
    height, width: CHART_WIDTH, thresholdDays: settings.thresholdDays, locale,
    labels: { x: texts.xAxis, y: texts.yAxis, threshold: (d) => texts.thresholdLine.replace("{t}", texts.thresholdName(d)) },
  });
  const chartSvg = host.querySelector("svg")!;
  chartSvg.querySelector('rect[fill="transparent"]')?.remove(); // the hover area
  const css = getComputedStyle(document.documentElement);
  const colors = Object.fromEntries(COLOR_TOKENS.map((t) => [t, css.getPropertyValue(`--${t}`).trim()])) as Colors;
  const now = new Date();
  const { svg, width, height: h } = reportSvg({
    texts, locale, now, colors,
    project: project.name,
    team: teamName,
    types: effectiveTypes(settings, meta),
    states: series.map((s) => s.name),
    thresholdDays: settings.thresholdDays,
    includeCurrentIteration: settings.includeCurrentIteration,
    version: SDK.getExtensionContext().version,
    stats: reportStats(points, series, settings.thresholdDays),
    chart: { markup: chartSvg.innerHTML, height },
  });
  download(await toPng(svg, width, h), reportFileName(project.name, now));
}

/** Language picker under the Download report button; the user's Azure DevOps language comes first. */
let langMenu: HTMLDivElement | undefined;

function closeLangMenu(): void {
  langMenu?.remove();
  langMenu = undefined;
  document.removeEventListener("mousedown", onOutsideLangMenu, true);
  document.removeEventListener("keydown", onEscapeLangMenu, true);
}
function onOutsideLangMenu(e: MouseEvent): void {
  if (langMenu && !langMenu.contains(e.target as Node) && e.target !== $("export")) closeLangMenu();
}
function onEscapeLangMenu(e: KeyboardEvent): void { if (e.key === "Escape") closeLangMenu(); }

function openLangMenu(): void {
  if (langMenu) return closeLangMenu();
  const own = langOf(SDK.getPageContext()?.globalization?.culture);
  const langs = [own, ...LANGS.filter((l) => l !== own)];
  const button = $("export");
  langMenu = document.createElement("div");
  langMenu.className = "tip menu lang-menu";
  langMenu.id = "export-langs";
  langMenu.setAttribute("role", "menu");
  langMenu.innerHTML = `<div class="t">Report language</div>` +
    langs.map((l) => `<button type="button" class="it" role="menuitem" data-lang="${l}">${esc(LANG_NAMES[l])}</button>`).join("");
  document.body.appendChild(langMenu);
  const r = button.getBoundingClientRect();
  langMenu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - langMenu.offsetWidth - 8))}px`;
  langMenu.style.top = `${r.bottom + 4}px`;
  langMenu.addEventListener("click", (e) => {
    const lang = (e.target as HTMLElement).closest<HTMLElement>("[data-lang]")?.dataset.lang as Lang | undefined;
    if (!lang) return;
    closeLangMenu();
    exportReport(lang).catch((err) => status(`Could not create the report: ${err instanceof Error ? err.message : String(err)}`, true));
  });
  document.addEventListener("mousedown", onOutsideLangMenu, true);
  document.addEventListener("keydown", onEscapeLangMenu, true);
  langMenu.querySelector("button")?.focus();
}

/** Rows the item list shows until the user asks for all of them. */
const PREVIEW_ROWS = 5;
let showAll = false;

function renderTable(points: AgingPoint[]): void {
  const top = [...points].sort((a, b) => b.age - a.age || b.inState - a.inState);
  const n = (v: number) => Math.round(v).toLocaleString();
  $("items").hidden = !top.length;
  $("table").innerHTML =
    `<table><thead><tr><th>ID</th><th>Title</th><th>Type</th><th>State</th>` +
    `<th class="num">Days since start</th><th class="num">Days in state</th><th>Iteration path</th></tr></thead><tbody>` +
    top.map((p, i) => `<tr${i >= PREVIEW_ROWS && !showAll ? " hidden" : ""}><td><a data-id="${p.item.id}" class="mono">${p.item.id}</a></td><td>${esc(p.item.title)}</td>` +
      `<td>${esc(p.item.type)}</td><td>${esc(p.item.state)}</td><td class="num">${n(p.age)}</td>` +
      `<td class="num">${n(p.inState)}</td><td>${esc(p.item.iterationPath)}</td></tr>`).join("") +
    `</tbody></table>`;
  const more = $("more") as HTMLButtonElement;
  more.hidden = top.length <= PREVIEW_ROWS;
  more.textContent = showAll ? "Show fewer ▴" : `Show all ${top.length} items ▾`;
  more.setAttribute("aria-expanded", String(showAll));
}

async function main(): Promise<void> {
  await SDK.init({ applyTheme: true });
  watchTheme(() => { if (items.length) draw(); });
  project = SDK.getWebContext().project;
  $("version").textContent = `Aging WIP v${SDK.getExtensionContext().version}`;
  restore();

  status("Loading project settings…");
  const [m, teams] = await Promise.all([loadProjectMeta(project.id), loadTeams(project.id)]);
  meta = m;

  const team = $("team") as HTMLSelectElement;
  team.innerHTML = `<option value="">Entire project</option>` +
    teams.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
  if (!teams.some((t) => t.id === settings.teamId)) settings.teamId = "";
  team.value = settings.teamId;
  const syncTeamName = () => { teamName = team.value ? team.selectedOptions[0]?.textContent ?? "" : ""; };
  syncTeamName();
  team.addEventListener("change", () => { settings = { ...settings, teamId: team.value }; syncTeamName(); persist(); void reload(); });

  $("threshold").addEventListener("change", (e) => {
    settings = { ...settings, thresholdDays: Number((e.target as HTMLSelectElement).value) };
    persist(); draw();
  });
  $("current-iteration").addEventListener("change", (e) => {
    settings = { ...settings, includeCurrentIteration: (e.target as HTMLInputElement).checked };
    persist(); void reload();
  });
  $("refresh").addEventListener("click", () => { metaStale = true; void reload(); });
  $("status").addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("#reload-page")) location.reload(); });
  $("export").addEventListener("click", openLangMenu);
  $("more").addEventListener("click", () => { showAll = !showAll; draw(); });
  $("table").addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest("a")?.dataset.id;
    if (id) void openWorkItem(Number(id));
  });
  let t: number | undefined;
  addEventListener("resize", () => { clearTimeout(t); t = window.setTimeout(() => items.length && draw(), 150); });

  renderControls();
  await reload();
}

main().catch((e) => status(e instanceof Error ? e.message : String(e), true, true));
