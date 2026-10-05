/**
 * Shared state of the fake host, configured from the page URL:
 *
 *   ?scenario=agile|scrum|no-state-change-date|empty|error   (default agile)
 *   &theme=light|dark
 *   &team=<team id>        dashboard team for widget pages (default team-a; "none" = project dashboard)
 *   &settings=<json>       widget custom settings, as stored by the configuration
 *   &name=<text>           widget title
 *   &cols=4&rows=3         widget size
 *   &delay=<ms>            every API response waits this long (shows the loader)
 *
 * Everything is exposed as window.__mock so tests can inspect calls and drive the page.
 */
import { createMockApi, type RecordedCall } from "./api.ts";
import { SCENARIOS, type MockTeam, type Scenario } from "./scenarios.ts";

type Page = "hub" | "widget" | "config";

const params = new URLSearchParams(location.search);
const page: Page = location.pathname.includes("config") ? "config" : location.pathname.includes("widget") ? "widget" : "hub";
const scenarioName = params.get("scenario") ?? "agile";
const scenario: Scenario | undefined = SCENARIOS[scenarioName];
if (!scenario) throw new Error(`Unknown scenario "${scenarioName}". Known: ${Object.keys(SCENARIOS).join(", ")}`);

const project = { id: "0f1e2d3c-0000-4000-8000-000000000001", name: "Demo" };
const teamParam = params.get("team") ?? "team-a";
const api = createMockApi(scenario, project, Date.now(), Number(params.get("delay") ?? 0));

const DARK = `:root{--background-color:#1b1a19;--callout-background-color:#252423;--text-primary-color:rgba(255,255,255,.9);--text-secondary-color:rgba(255,255,255,.6)}`;
const LIGHT = `:root{--background-color:#ffffff;--callout-background-color:#ffffff;--text-primary-color:rgba(0,0,0,.9);--text-secondary-color:rgba(0,0,0,.55)}`;

export interface Notification { event: string; data: unknown }

export const mock = {
  page,
  scenarioName,
  scenario,
  project,
  team: page === "hub" || teamParam === "none" ? undefined : scenario.teams.find((t) => t.id === teamParam) as MockTeam | undefined,
  contributionId: page === "hub" ? "aging-wip-hub" : page === "widget" ? "aging-wip-widget" : "aging-wip-widget-config",
  theme: (params.get("theme") === "dark" ? "dark" : "light") as "light" | "dark",
  calls: api.calls as RecordedCall[],
  opened: [] as number[],
  notifications: [] as Notification[],
  registered: new Map<string, any>(),
  initOptions: undefined as unknown,
  loaded: false,
  loadError: undefined as string | undefined,
  /** Result of the host's load()/reload()/onSave() call, once it settles. */
  hostResult: undefined as unknown,
  hostError: undefined as unknown,

  widgetSettings() {
    return {
      name: params.get("name") ?? "Aging WIP",
      size: { columnSpan: Number(params.get("cols") ?? 4), rowSpan: Number(params.get("rows") ?? 3) },
      customSettings: { data: params.get("settings") ?? "" },
    };
  },

  /** Swap the host theme variables and fire the SDK's themeApplied event. */
  setTheme(theme: "light" | "dark") {
    this.theme = theme;
    let style = document.getElementById("mock-theme");
    if (!style) {
      style = document.createElement("style");
      style.id = "mock-theme";
      document.head.prepend(style);
    }
    style.textContent = theme === "dark" ? DARK : LIGHT;
    window.dispatchEvent(new CustomEvent("themeApplied", { detail: {} }));
  },

  instance() {
    const id = [...this.registered.keys()].find((k) => k.endsWith(this.contributionId));
    return id ? this.registered.get(id) : undefined;
  },

  async driveHost() {
    const inst = this.instance();
    if (page === "hub") return;
    if (!inst) { this.hostError = `Nothing registered for ${this.contributionId}`; return; }
    try {
      if (page === "widget") {
        this.hostResult = await inst.load(this.widgetSettings());
      } else {
        const ctx = { notify: async (event: string, args: { data: unknown }) => { this.notifications.push({ event, data: args.data }); renderPanel(); } };
        this.hostResult = await inst.load(this.widgetSettings(), ctx);
      }
    } catch (e) {
      this.hostError = e;
    }
    renderPanel();
  },

  /** What the dashboard would store when the user presses Save in the configuration. */
  async save() {
    return this.instance()?.onSave();
  },
};

/** On the configuration page, show what the extension reports to the host. */
function renderPanel() {
  if (page !== "config") return;
  let panel = document.getElementById("mock-panel");
  if (!panel) {
    panel = document.createElement("pre");
    panel.id = "mock-panel";
    panel.style.cssText = "margin:16px 2px;padding:8px;font:11px ui-monospace,monospace;white-space:pre-wrap;border:1px dashed #999;border-radius:4px";
    document.body.appendChild(panel);
  }
  const last = mock.notifications[mock.notifications.length - 1];
  const data = (last?.data as { data?: string } | undefined)?.data;
  panel.textContent = `[mock host] ${mock.notifications.length} configuration change(s)` +
    (data ? `\ncustomSettings.data = ${JSON.stringify(JSON.parse(data), null, 2)}` : "") +
    (mock.hostError ? `\nload failed: ${JSON.stringify(mock.hostError)}` : "");
}

window.fetch = api.fetch;
(window as any).__mock = mock;
