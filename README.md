# Aging WIP for Azure DevOps

An Azure DevOps extension that adds an **Aging WIP** chart to Azure Boards, based on the Aging WIP slide of the "Azure DevOps + AI" deck.

Each dot is an open work item:

- **x axis**: age, days since work started: the first time the item entered a state in the InProgress or Resolved category, read from its history,
- **y axis**: days in the current state (`Microsoft.VSTS.Common.StateChangeDate`),
- **dashed diagonal**: items that have not changed state since work started,
- **red line**: "N days in the same state" threshold (1 year by default; 30 days, 90 days, 6 months, 1 year or 2 years),
- dot colour is the state; hover for details, click to open the work item.

Below the chart there is a one-line summary, e.g. "27 of 140 items have been in the same state for more than 1 year. Only 50 items changed state in the last 30 days."

## What's included

| Part | Where | Description |
|---|---|---|
| **Aging WIP** hub | Boards → Aging WIP | Pick team, work item types, states and threshold; legend with counts (click to hide a state); table of the 50 items longest in their current state. Settings are remembered in the browser per project. |
| **Aging WIP** widget | Dashboard → Add widget | Sizes from 2×2 to 6×4. Configuration: team (defaults to the dashboard's team), types, states, threshold. |

## How the data is computed

1. Work item types and states come from the project's process (`_apis/wit/workitemtypes`), so Agile, Scrum, CMMI, Basic and inherited processes all work.
   - Default types: the Requirement and Bug categories (e.g. User Story + Bug, or Product Backlog Item + Bug).
   - Default states: every state in the **InProgress** and **Resolved** categories (e.g. Active, Resolved, plus custom states such as OnHold or For Testing when they belong to those categories).
2. A WIQL query returns open items in the selected states. For a team it adds the team's area filter (team field values, usually Area Path with "include children").
3. Fields are fetched in batches of 200 (`workitemsbatch`).
4. Each item's update history (`workItems/{id}/updates`) gives the start date: the first entry into an InProgress or Resolved state of that work item type. This is one request per item (usually a single page), so a few hundred items take a few seconds; the hub shows progress. Items with no recorded start (e.g. after a state rename) fall back to the date they entered their current state.
5. If the process has no `StateChangeDate`, the last state change is read from the same history.

Scopes: `vso.work` (read work items) and `vso.project` (list teams). The extension never writes to Azure DevOps.

## Build

Requires Node.js 20+.

```bash
npm install
npm test            # unit tests for the calculations
npm run build       # typecheck + bundle into dist/
npm run package     # build + .vsix in out/
```

## Publish and install

1. Create a publisher at <https://marketplace.visualstudio.com/manage/createpublisher>.
2. The `publisher` field in `vss-extension.json` is set to `TomaszZelezny`; to publish under another publisher, change it or pass `npm run package -- --publisher YOUR-ID`.
3. Upload `out/*.vsix` in the publisher portal (**New extension → Azure DevOps**). The extension is private (`"public": false`).
4. In the publisher portal: **Share** → your Azure DevOps organization name.
5. In the organization: **Organization settings → Extensions → Shared** → install.

To test alongside the production version: `npm run package:dev` builds a separate `aging-wip-dev` extension.

## Layout

```
src/core/compute.ts   calculations (age, time in state, default types and states, summary) – pure functions
src/core/data.ts      data loading from the Azure DevOps REST API
src/core/chart.ts     SVG chart, tooltip, legend
src/hub/hub.ts        Boards hub
src/widget/           dashboard widget and its configuration
static/               HTML and CSS (deck palette, light and dark theme)
vss-extension.json    extension manifest
```

## Limitations

- WIQL returns at most 20,000 items.
- Age counts from the *first* start. An item moved back to New and restarted keeps its original start date.
- Bulk state changes reset "days in current state", because that is how `StateChangeDate` works.
