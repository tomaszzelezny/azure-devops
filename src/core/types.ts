/** Settings shared by the hub and the dashboard widget. */
export interface AgingSettings {
  /** Team id; empty string means the whole project (no area filter). */
  teamId: string;
  /** Work item type names. Empty means the defaults (Requirement, Bug and Task categories). */
  types: string[];
  /** State names. Empty means every state in the InProgress and Resolved categories. */
  states: string[];
  /** Red vertical reference line: "N days since work started". */
  thresholdDays: number;
  /** When false, items in the team's current iteration (the default team's, for the whole project) are left out. */
  includeCurrentIteration: boolean;
}

export const DEFAULT_SETTINGS: AgingSettings = {
  teamId: "",
  types: [],
  states: [],
  thresholdDays: 365,
  includeCurrentIteration: true,
};

export interface StateMeta {
  name: string;
  /** Azure DevOps state category: Proposed, InProgress, Resolved, Completed, Removed. */
  category: string;
}

export interface TypeMeta {
  name: string;
  /** States in workflow order. */
  states: StateMeta[];
}

export interface ProjectMeta {
  types: TypeMeta[];
  /** Types used when the settings do not name any. */
  defaultTypes: string[];
}

export interface Team {
  id: string;
  name: string;
}

/** One open work item, as needed by the chart. */
export interface WipItem {
  id: number;
  title: string;
  type: string;
  state: string;
  assignedTo: string;
  iterationPath: string;
  createdDate: Date;
  /** When work started: first entry into an InProgress or Resolved state. */
  startedDate: Date;
  /** When the item entered its current state. */
  stateChangeDate: Date;
}
