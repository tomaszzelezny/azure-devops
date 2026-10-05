import { get, post, seg } from "./ado.ts";
import { escapeWiql, scanHistory, startStates, type StateUpdate } from "./compute.ts";
import type { ProjectMeta, Team, TypeMeta, WipItem } from "./types.ts";

interface List<T> { value: T[]; count?: number }

interface ApiType {
  name: string;
  isDisabled?: boolean;
  states?: { name: string; category: string }[];
}

interface ApiCategory {
  referenceName: string;
  workItemTypes: { name: string }[];
}

interface ApiWorkItem {
  id: number;
  fields: Record<string, unknown>;
}

interface ApiUpdate {
  fields?: Record<string, { newValue?: unknown }>;
}

/** Page size for the work item updates API (its maximum). */
const PAGE = 200;

const FIELDS = [
  "System.Id",
  "System.Title",
  "System.WorkItemType",
  "System.State",
  "System.AssignedTo",
  "System.CreatedDate",
  "Microsoft.VSTS.Common.StateChangeDate",
];

export async function loadProjectMeta(project: string): Promise<ProjectMeta> {
  const [types, cats] = await Promise.all([
    get<List<ApiType>>(`${seg(project)}/_apis/wit/workitemtypes`),
    get<List<ApiCategory>>(`${seg(project)}/_apis/wit/workitemtypecategories`),
  ]);
  const inCat = (ref: string) => cats.value.find((c) => c.referenceName === ref)?.workItemTypes.map((t) => t.name) ?? [];
  const hidden = new Set(inCat("Microsoft.HiddenCategory"));
  const visible: TypeMeta[] = types.value
    .filter((t) => !t.isDisabled && !hidden.has(t.name))
    .map((t) => ({ name: t.name, states: (t.states ?? []).map((s) => ({ name: s.name, category: s.category })) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    types: visible,
    defaultTypes: [...inCat("Microsoft.RequirementCategory"), ...inCat("Microsoft.BugCategory")],
  };
}

export async function loadTeams(projectId: string): Promise<Team[]> {
  const res = await get<List<Team>>(`_apis/projects/${seg(projectId)}/teams?$top=1000`);
  return res.value.map((t) => ({ id: t.id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** WIQL clause restricting to the team's area paths (or whatever its team field is). */
async function teamClause(project: string, teamId: string): Promise<string> {
  if (!teamId) return "";
  const tfv = await get<{ field: { referenceName: string }; values: { value: string; includeChildren: boolean }[] }>(
    `${seg(project)}/${seg(teamId)}/_apis/work/teamsettings/teamfieldvalues`);
  if (!tfv.values.length) return "";
  const f = `[${tfv.field.referenceName}]`;
  const parts = tfv.values.map((v) => `${f} ${v.includeChildren ? "UNDER" : "="} ${escapeWiql(v.value)}`);
  return ` AND (${parts.join(" OR ")})`;
}

export async function loadWipItems(
  project: string, teamId: string, types: string[], states: string[], meta: ProjectMeta,
  onProgress?: (done: number, total: number) => void,
): Promise<WipItem[]> {
  if (!types.length || !states.length) return [];
  const query =
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project" +
    ` AND [System.WorkItemType] IN (${types.map(escapeWiql).join(", ")})` +
    ` AND [System.State] IN (${states.map(escapeWiql).join(", ")})` +
    (await teamClause(project, teamId));
  const res = await post<{ workItems: { id: number }[] }>(`${seg(project)}/_apis/wit/wiql?$top=20000`, { query });
  const ids = res.workItems.map((w) => w.id);

  const batches: Promise<List<ApiWorkItem>>[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    batches.push(post<List<ApiWorkItem>>(`${seg(project)}/_apis/wit/workitemsbatch`, { ids: ids.slice(i, i + 200), fields: FIELDS }));
  }
  const raw = (await Promise.all(batches)).flatMap((b) => b.value);
  const items = raw.map(toItem);
  await fillHistory(items, startStates(meta), onProgress);
  return items;
}

function toItem(w: ApiWorkItem): WipItem {
  const f = w.fields;
  const assigned = f["System.AssignedTo"] as { displayName?: string } | string | undefined;
  const created = new Date(f["System.CreatedDate"] as string);
  const changed = f["Microsoft.VSTS.Common.StateChangeDate"] as string | undefined;
  return {
    id: w.id,
    title: String(f["System.Title"] ?? ""),
    type: String(f["System.WorkItemType"] ?? ""),
    state: String(f["System.State"] ?? ""),
    assignedTo: typeof assigned === "string" ? assigned : assigned?.displayName ?? "",
    createdDate: created,
    startedDate: created, // replaced by fillHistory
    // NaN marks "unknown" until fillHistory resolves it.
    stateChangeDate: changed ? new Date(changed) : new Date(NaN),
  };
}

/**
 * Fill startedDate (and stateChangeDate where the process lacks that field) from each item's update history.
 * One request per item in the common case: the start is usually on the first page of updates.
 */
async function fillHistory(items: WipItem[], started: Map<string, Set<string>>, onProgress?: (done: number, total: number) => void): Promise<void> {
  const todo = [...items];
  let done = 0;
  const worker = async () => {
    for (let it = todo.pop(); it; it = todo.pop()) {
      const needLast = isNaN(it.stateChangeDate.getTime());
      const starts = started.get(it.type) ?? new Set<string>();
      const history: StateUpdate[] = [];
      for (let skip = 0; ; skip += PAGE) {
        const page = await get<List<ApiUpdate>>(`_apis/wit/workItems/${it.id}/updates?$top=${PAGE}&$skip=${skip}`);
        for (const u of page.value) {
          history.push({ state: u.fields?.["System.State"]?.newValue as string | undefined, date: u.fields?.["System.ChangedDate"]?.newValue as string | undefined });
        }
        if (page.value.length < PAGE || (!needLast && scanHistory(history, starts).firstStart)) break;
      }
      const { firstStart, lastChange } = scanHistory(history, starts);
      if (needLast) it.stateChangeDate = lastChange ?? it.createdDate;
      // Without a recorded start (e.g. renamed states), fall back to entering the current state.
      const start = firstStart ?? it.stateChangeDate;
      it.startedDate = start < it.stateChangeDate ? start : it.stateChangeDate;
      onProgress?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}
