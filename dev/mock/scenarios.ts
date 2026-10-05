/**
 * Deterministic fake Azure DevOps projects for the dev server and the e2e tests.
 *
 * Dates are relative to "now" when the page loads, so ages are stable whatever the day.
 * Items with ids 1001–1099 are hand-written anchors with exact values that tests assert on;
 * ids from 2000 up are seeded filler that makes the chart look realistic.
 */

export interface MockState { name: string; category: "Proposed" | "InProgress" | "Resolved" | "Completed" | "Removed" }
export interface MockType { name: string; states: MockState[] }

export interface MockProcess {
  types: MockType[];
  requirement: string[];
  bug: string[];
  hidden: string[];
}

export interface MockTeam { id: string; name: string; areas: { value: string; includeChildren: boolean }[] }

export interface MockItem {
  id: number;
  title: string;
  type: string;
  state: string;
  area: string;
  assignedTo?: string;
  /** State transitions, oldest first; the first one is the creation. Days are "days ago". */
  transitions: { state: string; daysAgo: number }[];
  /** Field-only updates inserted right after creation (exercises paging of the updates API). */
  noiseUpdates?: number;
}

export interface Scenario {
  description: string;
  process: MockProcess;
  teams: MockTeam[];
  items: MockItem[];
  /** Simulate a process without Microsoft.VSTS.Common.StateChangeDate. */
  noStateChangeDate?: boolean;
  /** Make an endpoint fail: key is a substring of the request path. */
  failures?: Record<string, { status: number; message: string }>;
}

const S = (name: string, category: MockState["category"]): MockState => ({ name, category });

export const AGILE: MockProcess = {
  types: [
    { name: "User Story", states: [S("New", "Proposed"), S("Active", "InProgress"), S("OnHold", "InProgress"), S("For Testing", "Resolved"), S("Resolved", "Resolved"), S("Closed", "Completed"), S("Removed", "Removed")] },
    { name: "Bug", states: [S("New", "Proposed"), S("Active", "InProgress"), S("For Testing", "Resolved"), S("Resolved", "Resolved"), S("Closed", "Completed")] },
    { name: "Task", states: [S("New", "Proposed"), S("Active", "InProgress"), S("Closed", "Completed"), S("Removed", "Removed")] },
    { name: "Test Plan", states: [S("Active", "InProgress"), S("Inactive", "Completed")] },
  ],
  requirement: ["User Story"],
  bug: ["Bug"],
  hidden: ["Test Plan"],
};

export const SCRUM: MockProcess = {
  types: [
    { name: "Product Backlog Item", states: [S("New", "Proposed"), S("Approved", "Proposed"), S("Committed", "InProgress"), S("Done", "Completed"), S("Removed", "Removed")] },
    { name: "Bug", states: [S("New", "Proposed"), S("Approved", "Proposed"), S("Committed", "InProgress"), S("Done", "Completed"), S("Removed", "Removed")] },
    { name: "Task", states: [S("To Do", "Proposed"), S("In Progress", "InProgress"), S("Done", "Completed"), S("Removed", "Removed")] },
  ],
  requirement: ["Product Backlog Item"],
  bug: ["Bug"],
  hidden: [],
};

const TEAMS: MockTeam[] = [
  { id: "team-a", name: "Team A", areas: [{ value: "Demo\\Team A", includeChildren: true }] },
  { id: "team-b", name: "Team B", areas: [{ value: "Demo\\Team B", includeChildren: false }] },
];

/** Anchors with exact expected values (age = days since first start, inState = days in current state). */
export const ANCHORS = {
  stuckInTesting: { id: 1001, age: 450, inState: 400 },
  fresh: { id: 1002, age: 10, inState: 10 },
  restarted: { id: 1003, age: 250, inState: 50 },
  longHistory: { id: 1004, age: 100, inState: 30 },
  renamedState: { id: 1005, age: 80, inState: 80 },
  teamB: { id: 1006, age: 60, inState: 20 },
} as const;

function agileAnchors(): MockItem[] {
  const a = "Demo\\Team A";
  return [
    { id: 1001, title: "Anchor: stuck in testing", type: "User Story", state: "For Testing", area: a, assignedTo: "Ada Lovelace",
      transitions: [{ state: "New", daysAgo: 500 }, { state: "Active", daysAgo: 450 }, { state: "For Testing", daysAgo: 400 }] },
    { id: 1002, title: "Anchor: fresh bug", type: "Bug", state: "Active", area: `${a}\\Mobile`,
      transitions: [{ state: "New", daysAgo: 20 }, { state: "Active", daysAgo: 10 }] },
    { id: 1003, title: "Anchor: restarted after going back to New", type: "User Story", state: "Active", area: a,
      transitions: [{ state: "New", daysAgo: 300 }, { state: "Active", daysAgo: 250 }, { state: "New", daysAgo: 200 }, { state: "Active", daysAgo: 50 }] },
    { id: 1004, title: "Anchor: long history (start on page 2)", type: "User Story", state: "OnHold", area: a, noiseUpdates: 230,
      transitions: [{ state: "New", daysAgo: 400 }, { state: "Active", daysAgo: 100 }, { state: "OnHold", daysAgo: 30 }] },
    { id: 1005, title: "Anchor: history uses a renamed state", type: "User Story", state: "Active", area: a,
      transitions: [{ state: "New", daysAgo: 90 }, { state: "In Flight", daysAgo: 80 }] },
    { id: 1006, title: "Anchor: Team B item", type: "Bug", state: "Active", area: "Demo\\Team B",
      transitions: [{ state: "New", daysAgo: 70 }, { state: "Active", daysAgo: 60 }, { state: "For Testing", daysAgo: 40 }, { state: "Active", daysAgo: 20 }] },
    { id: 1007, title: "Anchor: closed (must not appear)", type: "User Story", state: "Closed", area: a,
      transitions: [{ state: "New", daysAgo: 100 }, { state: "Active", daysAgo: 90 }, { state: "Closed", daysAgo: 5 }] },
    { id: 1008, title: "Anchor: not started (must not appear)", type: "User Story", state: "New", area: a,
      transitions: [{ state: "New", daysAgo: 700 }] },
    { id: 1009, title: "Anchor: task (hidden by default types)", type: "Task", state: "Active", area: a,
      transitions: [{ state: "New", daysAgo: 15 }, { state: "Active", daysAgo: 12 }] },
  ];
}

/** Park–Miller PRNG: same sequence on every run. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function filler(process: MockProcess, count: number, seed: number): MockItem[] {
  const rnd = rng(seed);
  const people = ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Linus Torvalds", "Margaret Hamilton"];
  const types = [...process.requirement, ...process.bug];
  const out: MockItem[] = [];
  for (let i = 0; i < count; i++) {
    const type = types[rnd() < 0.7 ? 0 : types.length - 1];
    const states = process.types.find((t) => t.name === type)!.states;
    const proposed = states.find((s) => s.category === "Proposed")!.name;
    const started = states.filter((s) => s.category === "InProgress" || s.category === "Resolved").map((s) => s.name);
    const created = Math.round(Math.pow(rnd(), 2) * 1400) + 5;
    const start = Math.max(1, Math.round(created * (0.3 + rnd() * 0.7)));
    const current = started[Math.floor(rnd() * rnd() * started.length)];
    const inState = Math.max(0, Math.round(rnd() < 0.3 ? start : start * rnd()));
    const transitions = [{ state: proposed, daysAgo: created }, { state: started[0], daysAgo: start }];
    if (current !== started[0] || inState < start) transitions.push({ state: current, daysAgo: Math.min(inState, start) });
    out.push({
      id: 2000 + i,
      title: `Filler item ${i}`,
      type,
      state: transitions[transitions.length - 1].state,
      area: rnd() < 0.75 ? "Demo\\Team A" : "Demo\\Team B",
      assignedTo: rnd() < 0.7 ? people[i % people.length] : undefined,
      transitions,
    });
  }
  return out;
}

function scrumAnchors(): MockItem[] {
  return [
    { id: 1101, title: "Anchor: committed PBI", type: "Product Backlog Item", state: "Committed", area: "Demo\\Team A",
      transitions: [{ state: "New", daysAgo: 60 }, { state: "Approved", daysAgo: 50 }, { state: "Committed", daysAgo: 30 }] },
  ];
}

export const SCENARIOS: Record<string, Scenario> = {
  agile: {
    description: "Agile process with custom OnHold / For Testing states, two teams",
    process: AGILE, teams: TEAMS, items: [...agileAnchors(), ...filler(AGILE, 130, 7)],
  },
  scrum: {
    description: "Scrum process (PBI, Committed)",
    process: SCRUM, teams: TEAMS, items: [...scrumAnchors(), ...filler(SCRUM, 60, 11)],
  },
  "no-state-change-date": {
    description: "Process without StateChangeDate: time in state comes from history",
    process: AGILE, teams: TEAMS, items: agileAnchors(), noStateChangeDate: true,
  },
  empty: {
    description: "Nothing in progress",
    process: AGILE, teams: TEAMS, items: agileAnchors().filter((i) => i.state === "Closed" || i.state === "New"),
  },
  error: {
    description: "WIQL query fails",
    process: AGILE, teams: TEAMS, items: agileAnchors(),
    failures: { "/wiql": { status: 400, message: "VS402337: The number of work items returned exceeds the size limit of 20000." } },
  },
};
