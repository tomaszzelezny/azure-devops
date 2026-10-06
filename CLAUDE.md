# Aging WIP – Azure DevOps extension

Boards hub + dashboard widget showing an Aging WIP scatter (x: days since work started, y: days in current state).
UI text is English. Conversation with the owner is usually in Polish.

## Commands

- `npm run dev` – production code against a fake Azure DevOps host, http://localhost:8080/ (hub, widget in every size, config; scenario/theme pickers). Rebuilds on change.
- `npm test` – unit tests (`test/`, node:test): calculations and manifest consistency.
- `npm run test:e2e` – Playwright against the fake host (`e2e/`).
- `npm run screenshots` – renders every page/theme into `screenshots/` for visual review.
- `npm run check` – typecheck + unit + e2e. Run before every push.
- `npm run version:bump` (or `npm run version:bump -- minor|major|X.Y.Z`) – bumps `vss-extension.json` and `package.json` together.
- `npm run package` – `.vsix` in `out/` (publisher `TomaszZelezny`).

## Layout

- `src/core/compute.ts` – pure logic (defaults, state categories, history scan, summary). Unit-test anything added here.
- `src/core/data.ts` – REST calls (WIQL → workitemsbatch → per-item updates). `ado.ts` adds auth and `api-version=7.1`.
- `src/core/chart.ts` – SVG chart, tooltip, legend. No chart library.
- `src/hub/`, `src/widget/` – page controllers. `static/` – HTML/CSS copied into `dist/`.
- `dev/mock/` – the fake host: `sdk.ts` replaces `azure-devops-extension-sdk` (esbuild alias in `build.mjs --mock`), `api.ts` fakes the REST endpoints and really evaluates the WIQL, `scenarios.ts` holds deterministic data, `state.ts` reads URL params and exposes `window.__mock`.

## Rules

- Only call REST endpoints through `src/core/ado.ts`. A new endpoint needs a handler in `dev/mock/api.ts` (unhandled calls log a console error, which fails e2e tests) and, if it needs a new scope, a manifest change.
- Do not import `azure-devops-extension-api`: it ships AMD modules esbuild cannot bundle. Copy the few types needed.
- States offered by the UI are only those in the InProgress and Resolved categories (`wipStatesOf`). Work start = first entry into such a state, from item history.
- Behaviour visible to users gets an e2e test; exact numbers come from the anchor items (ids 1001+) in `dev/mock/scenarios.ts`, never from the seeded filler.
- Changing the contribution ids, page names or bundle names: `test/manifest.test.ts` checks they line up.
- Release: `npm run check`, `npm run version:bump`, `npm run package`, upload the `.vsix` with **Update** in the Marketplace publisher portal. The Package workflow runs on every merge to main (and on demand); it bumps the patch (when the current version is already tagged), commits, tags and builds.
