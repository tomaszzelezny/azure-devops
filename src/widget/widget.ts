import * as SDK from "azure-devops-extension-sdk";
import { renderAgingChart, renderLegend, esc } from "../core/chart.ts";
import { effectiveStates, effectiveTypes, NO_ITEMS, seriesFor, summary, thresholdLabel, toPoints, type AgingPoint } from "../core/compute.ts";
import { loadProjectMeta, loadWipItems } from "../core/data.ts";
import { openWorkItem } from "../core/navigation.ts";
import { watchTheme } from "../core/theme.ts";
import { parseSettings, WidgetStatusType, type WidgetSettings, type WidgetStatus } from "./settings.ts";

const $ = (id: string) => document.getElementById(id)!;

let last: { points: AgingPoint[]; states: string[]; threshold: number } | undefined;

function draw(): void {
  if (!last) return;
  const { points, states, threshold } = last;
  const series = seriesFor(states, points);
  const hidden = new Set<string>();
  renderLegend($("legend"), series, hidden);
  const s = summary(points, threshold);
  $("take").innerHTML = s.total
    ? `<b>${s.stuck} of ${s.total}</b> in the same state for more than ${esc(thresholdLabel(threshold))}`
    : NO_ITEMS;
  // Measure after the legend and summary are in place, so the chart gets exactly the remaining height.
  const chart = $("chart");
  chart.innerHTML = "";
  renderAgingChart(chart, points, series, { height: chart.clientHeight, thresholdDays: threshold, compact: true, onOpen: openWorkItem });
}

async function render(ws: WidgetSettings): Promise<WidgetStatus> {
  try {
    $("title").textContent = ws.name || "Aging WIP";
    const ctx = SDK.getWebContext();
    const stored = parseSettings(ws);
    const teamId = stored.teamId ?? ctx.team?.id ?? "";
    const settings = { ...stored, teamId };
    const meta = await loadProjectMeta(ctx.project.id);
    const states = effectiveStates(settings, meta);
    const items = await loadWipItems(ctx.project.id, teamId, effectiveTypes(settings, meta), states);
    last = { points: toPoints(items, new Date()), states, threshold: settings.thresholdDays };
    draw();
    return { statusType: WidgetStatusType.Success };
  } catch (e) {
    // Dashboards expect a rejected promise carrying a user-visible message on failure.
    throw { message: e instanceof Error ? e.message : String(e), isUserVisible: true, isRichText: false };
  }
}

async function main(): Promise<void> {
  await SDK.init({ loaded: false, applyTheme: true });
  watchTheme(draw);
  const instance = () => ({
    load: render,
    reload: render,
  });
  // The host may look the object up by full contribution id or by the bare id from the manifest.
  SDK.register(SDK.getContributionId(), instance);
  SDK.register("aging-wip-widget", instance);
  let t: number | undefined;
  addEventListener("resize", () => { clearTimeout(t); t = window.setTimeout(draw, 100); });
  await SDK.notifyLoadSucceeded();
}

void main();
