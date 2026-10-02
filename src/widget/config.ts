import * as SDK from "azure-devops-extension-sdk";
import { esc } from "../core/chart.ts";
import { effectiveStates, effectiveTypes, statesOf } from "../core/compute.ts";
import { loadProjectMeta, loadTeams } from "../core/data.ts";
import { watchTheme } from "../core/theme.ts";
import { checkboxes, openStateFilter } from "../core/ui.ts";
import type { ProjectMeta } from "../core/types.ts";
import {
  CONFIGURATION_CHANGE, parseSettings, WidgetStatusType,
  type ConfigurationContext, type StoredSettings, type WidgetSettings,
} from "./settings.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DASHBOARD_TEAM = "__dashboard__";

let settings: StoredSettings;
let meta: ProjectMeta;
let context: ConfigurationContext;

const serialize = () => ({ data: JSON.stringify(settings) });

function changed(): void {
  void context.notify(CONFIGURATION_CHANGE, { data: serialize() });
}

function renderLists(): void {
  const full = { ...settings, teamId: "" };
  const types = effectiveTypes(full, meta);
  checkboxes($("types"), meta.types.map((t) => t.name), types, (next) => {
    settings = { ...settings, types: next, states: [] };
    renderLists(); changed();
  });
  const names = statesOf(types, meta).filter(openStateFilter).map((s) => s.name);
  checkboxes($("states"), names, effectiveStates(full, meta), (next) => {
    settings = { ...settings, states: next };
    renderLists(); changed();
  });
}

async function load(ws: WidgetSettings, ctx: ConfigurationContext) {
  context = ctx;
  settings = parseSettings(ws);
  const project = SDK.getWebContext().project;
  const [m, teams] = await Promise.all([loadProjectMeta(project.id), loadTeams(project.id)]);
  meta = m;

  const team = $<HTMLSelectElement>("team");
  team.innerHTML = `<option value="${DASHBOARD_TEAM}">Zespół dashboardu</option><option value="">Cały projekt</option>` +
    teams.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
  team.value = settings.teamId === undefined ? DASHBOARD_TEAM : settings.teamId;
  team.addEventListener("change", () => {
    settings = { ...settings, teamId: team.value === DASHBOARD_TEAM ? undefined : team.value };
    changed();
  });

  const thr = $<HTMLSelectElement>("threshold");
  thr.value = String(settings.thresholdDays);
  thr.addEventListener("change", () => { settings = { ...settings, thresholdDays: Number(thr.value) }; changed(); });

  renderLists();
  return { statusType: WidgetStatusType.Success };
}

async function main(): Promise<void> {
  await SDK.init({ loaded: false, applyTheme: true });
  watchTheme(() => {});
  const instance = () => ({
    load,
    onSave: async () => ({ customSettings: serialize(), isValid: true }),
  });
  // The host may look the object up by full contribution id or by the bare id from the manifest.
  SDK.register(SDK.getContributionId(), instance);
  SDK.register("aging-wip-widget-config", instance);
  await SDK.notifyLoadSucceeded();
}

void main();
