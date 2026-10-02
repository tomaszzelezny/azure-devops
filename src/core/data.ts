import { get, post, seg } from "./ado.ts";
import { escapeWiql } from "./compute.ts";
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

export async function loadWipItems(project: string, teamId: string, types: string[], states: string[]): Promise<WipItem[]> {
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
  await fillMissingStateChange(items);
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
    // NaN marks "unknown" until fillMissingStateChange resolves it.
    stateChangeDate: changed ? new Date(changed) : new Date(NaN),
  };
}

/** Processes without StateChangeDate: read the last state change from the item's update history. */
async function fillMissingStateChange(items: WipItem[]): Promise<void> {
  const todo = items.filter((i) => isNaN(i.stateChangeDate.getTime()));
  const worker = async () => {
    for (let it = todo.pop(); it; it = todo.pop()) {
      const updates = await get<List<ApiUpdate>>(`_apis/wit/workItems/${it.id}/updates?$top=1000`);
      const last = updates.value.filter((u) => u.fields?.["System.State"]).pop();
      const when = last?.fields?.["System.ChangedDate"]?.newValue as string | undefined;
      it.stateChangeDate = when ? new Date(when) : it.createdDate;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}
