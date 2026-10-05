/**
 * In-browser fake of the Azure DevOps REST endpoints the extension uses.
 * It actually evaluates the WIQL the extension sends (types, states, area paths),
 * so tests catch a wrong query, not just a wrong rendering.
 */
import type { MockItem, Scenario } from "./scenarios.ts";

export const MOCK_BASE = "/mock-ado/";
export const MOCK_TOKEN = "mock-token";
const DAY = 86_400_000;

export interface RecordedCall { method: string; path: string; body?: unknown }

/** Quoted WIQL literals: 'a', 'b''c' → ["a", "b'c"]. */
function literals(list: string): string[] {
  return [...list.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

interface WiqlFilter { types: string[]; states: string[]; areas: { path: string; under: boolean }[] }

export function parseWiql(query: string): WiqlFilter {
  if (!/\[System\.TeamProject\] = @project/.test(query)) throw new Error("WIQL must be scoped to @project");
  const types = query.match(/\[System\.WorkItemType\] IN \(([^)]*)\)/);
  const states = query.match(/\[System\.State\] IN \(([^)]*)\)/);
  if (!types || !states) throw new Error(`Unexpected WIQL: ${query}`);
  const areas = [...query.matchAll(/\[System\.AreaPath\] (UNDER|=) ('(?:[^']|'')*')/g)]
    .map((m) => ({ path: literals(m[2])[0], under: m[1] === "UNDER" }));
  return { types: literals(types[1]), states: literals(states[1]), areas };
}

function matches(item: MockItem, f: WiqlFilter): boolean {
  if (!f.types.includes(item.type) || !f.states.includes(item.state)) return false;
  if (!f.areas.length) return true;
  return f.areas.some((a) => item.area === a.path || (a.under && item.area.startsWith(a.path + "\\")));
}

const iso = (now: number, daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

function fields(item: MockItem, now: number, scenario: Scenario, wanted: string[]): Record<string, unknown> {
  const last = item.transitions[item.transitions.length - 1];
  const all: Record<string, unknown> = {
    "System.Id": item.id,
    "System.Title": item.title,
    "System.WorkItemType": item.type,
    "System.State": item.state,
    "System.AreaPath": item.area,
    "System.CreatedDate": iso(now, item.transitions[0].daysAgo),
    "System.AssignedTo": item.assignedTo ? { displayName: item.assignedTo, uniqueName: `${item.assignedTo.split(" ")[0].toLowerCase()}@example.com` } : undefined,
    "Microsoft.VSTS.Common.StateChangeDate": scenario.noStateChangeDate ? undefined : iso(now, last.daysAgo),
  };
  // Like the real API: unset fields are simply missing.
  return Object.fromEntries(wanted.filter((k) => all[k] !== undefined).map((k) => [k, all[k]]));
}

function updates(item: MockItem, now: number) {
  const out: { id: number; rev: number; fields: Record<string, { oldValue?: unknown; newValue?: unknown }> }[] = [];
  const created = item.transitions[0];
  let prev: string | undefined;
  item.transitions.forEach((t, i) => {
    if (i === 1) {
      // Field-only noise between creation and the first transition.
      for (let n = 0; n < (item.noiseUpdates ?? 0); n++) {
        const days = created.daysAgo - ((created.daysAgo - t.daysAgo) * (n + 1)) / ((item.noiseUpdates ?? 0) + 1);
        out.push({ id: out.length + 1, rev: out.length + 1, fields: { "System.Description": { newValue: `edit ${n}` }, "System.ChangedDate": { newValue: iso(now, days) } } });
      }
    }
    out.push({ id: out.length + 1, rev: out.length + 1, fields: {
      "System.State": { oldValue: prev, newValue: t.state },
      "System.ChangedDate": { newValue: iso(now, t.daysAgo) },
    } });
    prev = t.state;
  });
  return out;
}

export function createMockApi(scenario: Scenario, project: { id: string; name: string }, now = Date.now()) {
  const calls: RecordedCall[] = [];
  const isProject = (seg: string) => seg === project.id || seg === project.name;

  async function handle(method: string, path: string, query: URLSearchParams, body: any): Promise<unknown> {
    for (const [key, f] of Object.entries(scenario.failures ?? {})) {
      if (path.includes(key)) throw Object.assign(new Error(f.message), { status: f.status });
    }
    const seg = path.split("/");
    let m: RegExpMatchArray | null;

    if (method === "GET" && seg.length === 4 && isProject(seg[0]) && path.endsWith("/_apis/wit/workitemtypes")) {
      const p = scenario.process;
      return { count: p.types.length, value: p.types.map((t) => ({ name: t.name, states: t.states })) };
    }
    if (method === "GET" && isProject(seg[0]) && path.endsWith("/_apis/wit/workitemtypecategories")) {
      const p = scenario.process;
      const cat = (referenceName: string, names: string[]) => ({ referenceName, workItemTypes: names.map((name) => ({ name })) });
      return { value: [cat("Microsoft.RequirementCategory", p.requirement), cat("Microsoft.BugCategory", p.bug), cat("Microsoft.HiddenCategory", p.hidden)] };
    }
    if (method === "GET" && (m = path.match(/^_apis\/projects\/([^/]+)\/teams$/)) && isProject(decodeURIComponent(m[1]))) {
      return { value: scenario.teams.map((t) => ({ id: t.id, name: t.name })) };
    }
    if (method === "GET" && (m = path.match(/^([^/]+)\/([^/]+)\/_apis\/work\/teamsettings\/teamfieldvalues$/)) && isProject(decodeURIComponent(m[1]))) {
      const team = scenario.teams.find((t) => t.id === decodeURIComponent(m![2]) || t.name === decodeURIComponent(m![2]));
      if (!team) throw Object.assign(new Error(`Team ${m[2]} not found`), { status: 404 });
      return { field: { referenceName: "System.AreaPath" }, values: team.areas };
    }
    if (method === "POST" && isProject(seg[0]) && path.endsWith("/_apis/wit/wiql")) {
      const top = Number(query.get("$top") ?? 20000);
      const f = parseWiql(body.query);
      const hits = scenario.items.filter((i) => matches(i, f)).slice(0, top);
      return { queryType: "flat", workItems: hits.map((i) => ({ id: i.id, url: "" })) };
    }
    if (method === "POST" && isProject(seg[0]) && path.endsWith("/_apis/wit/workitemsbatch")) {
      if (body.ids.length > 200) throw Object.assign(new Error("workitemsbatch accepts at most 200 ids"), { status: 400 });
      const items = body.ids.map((id: number) => scenario.items.find((i) => i.id === id)).filter(Boolean) as MockItem[];
      return { count: items.length, value: items.map((i) => ({ id: i.id, rev: 1, fields: fields(i, now, scenario, body.fields) })) };
    }
    if (method === "GET" && (m = path.match(/^_apis\/wit\/workItems\/(\d+)\/updates$/))) {
      const item = scenario.items.find((i) => i.id === Number(m![1]));
      if (!item) throw Object.assign(new Error(`Work item ${m[1]} not found`), { status: 404 });
      const top = Math.min(Number(query.get("$top") ?? 200), 200);
      const skip = Number(query.get("$skip") ?? 0);
      const value = updates(item, now).slice(skip, skip + top);
      return { count: value.length, value };
    }
    throw Object.assign(new Error(`Mock API: no handler for ${method} ${path}`), { status: 404 });
  }

  const realFetch = window.fetch.bind(window);

  async function fetchMock(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith(MOCK_BASE)) return realFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.slice(MOCK_BASE.length);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: path + url.search, body });

    const auth = new Headers(init?.headers).get("Authorization");
    if (auth !== `Bearer ${MOCK_TOKEN}`) return json(401, { message: "Missing or wrong bearer token" });
    if (url.searchParams.get("api-version") !== "7.1") return json(400, { message: `Unexpected api-version ${url.searchParams.get("api-version")}` });
    try {
      return json(200, await handle(method, path, url.searchParams, body));
    } catch (e: any) {
      if (e.status === 404) console.error(e.message);
      return json(e.status ?? 500, { message: e.message });
    }
  }

  return { calls, fetch: fetchMock };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
