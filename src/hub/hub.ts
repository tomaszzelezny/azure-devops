import * as SDK from "azure-devops-extension-sdk";
import { renderAgingChart, renderLegend, esc } from "../core/chart.ts";
import {
  effectiveStates, effectiveTypes, seriesFor, wipStatesOf, takeaway, toPoints, type AgingPoint,
} from "../core/compute.ts";
import { loadProjectMeta, loadTeams, loadWipItems } from "../core/data.ts";
import { openWorkItem } from "../core/navigation.ts";
import { watchTheme } from "../core/theme.ts";
import { checkboxes } from "../core/ui.ts";
import { DEFAULT_SETTINGS, type AgingSettings, type ProjectMeta, type WipItem } from "../core/types.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let project = { id: "", name: "" };
let meta: ProjectMeta;
let settings: AgingSettings = { ...DEFAULT_SETTINGS };
let items: WipItem[] = [];
const hidden = new Set<string>();
let loadSeq = 0;

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
}

function status(msg: string, err = false): void {
  const s = $("status");
  s.textContent = msg;
  s.className = "status" + (err ? " err" : "");
  s.hidden = !msg;
  $("result").hidden = !!msg;
}

async function reload(): Promise<void> {
  const seq = ++loadSeq;
  status("Loading work items…");
  try {
    const got = await loadWipItems(project.name, settings.teamId, effectiveTypes(settings, meta), effectiveStates(settings, meta), meta,
      (done, total) => { if (seq === loadSeq) status(`Reading work item history… ${done} / ${total}`); });
    if (seq !== loadSeq) return; // a newer request superseded this one
    items = got;
    status("");
    draw();
  } catch (e) {
    if (seq === loadSeq) status(e instanceof Error ? e.message : String(e), true);
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
}

function renderTable(points: AgingPoint[]): void {
  const top = [...points].sort((a, b) => b.inState - a.inState).slice(0, 50);
  const n = (v: number) => Math.round(v).toLocaleString();
  $("tableTitle").textContent = `Longest in current state (${top.length} of ${points.length})`;
  $("table").innerHTML =
    `<table><thead><tr><th>ID</th><th>Title</th><th>Type</th><th>State</th>` +
    `<th class="num">In state (days)</th><th class="num">Age (days)</th><th>Assigned to</th></tr></thead><tbody>` +
    top.map((p) => `<tr><td><a data-id="${p.item.id}" class="mono">${p.item.id}</a></td><td>${esc(p.item.title)}</td>` +
      `<td>${esc(p.item.type)}</td><td>${esc(p.item.state)}</td><td class="num">${n(p.inState)}</td>` +
      `<td class="num">${n(p.age)}</td><td>${esc(p.item.assignedTo)}</td></tr>`).join("") +
    `</tbody></table>`;
}

async function main(): Promise<void> {
  await SDK.init({ applyTheme: true });
  watchTheme(() => { if (items.length) draw(); });
  project = SDK.getWebContext().project;
  restore();

  const [m, teams] = await Promise.all([loadProjectMeta(project.id), loadTeams(project.id)]);
  meta = m;

  const team = $("team") as HTMLSelectElement;
  team.innerHTML = `<option value="">Entire project</option>` +
    teams.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
  if (!teams.some((t) => t.id === settings.teamId)) settings.teamId = "";
  team.value = settings.teamId;
  team.addEventListener("change", () => { settings = { ...settings, teamId: team.value }; persist(); void reload(); });

  $("threshold").addEventListener("change", (e) => {
    settings = { ...settings, thresholdDays: Number((e.target as HTMLSelectElement).value) };
    persist(); draw();
  });
  $("refresh").addEventListener("click", () => void reload());
  $("table").addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest("a")?.dataset.id;
    if (id) void openWorkItem(Number(id));
  });
  let t: number | undefined;
  addEventListener("resize", () => { clearTimeout(t); t = window.setTimeout(() => items.length && draw(), 150); });

  renderControls();
  await reload();
}

main().catch((e) => status(e instanceof Error ? e.message : String(e), true));
