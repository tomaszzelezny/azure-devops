# Contributing

Bug reports, ideas and pull requests are welcome.

## Issues

- **Bugs**: [open a bug report](https://github.com/tomaszzelezny/azure-devops/issues/new?template=bug_report.yml). The extension version, your process (Agile, Scrum, CMMI, Basic or inherited) and any errors from the browser console help the most.
- **Ideas**: [open a feature request](https://github.com/tomaszzelezny/azure-devops/issues/new?template=feature_request.yml) and describe the problem first, then the solution you have in mind.
- **Security problems**: report them privately, see [SECURITY.md](SECURITY.md).

Please don't paste real work item data you can't share publicly.

## Pull requests

For anything bigger than a small fix, open an issue first so we can agree on the approach.

1. `npm install`, then `npm run dev` to work against the fake Azure DevOps host at http://localhost:8080/ (see [Development](README.md#development)).
2. Put calculations in `src/core/compute.ts` with unit tests in `test/`. Behaviour users can see gets a Playwright test in `e2e/`, with numbers taken from the anchor items in `dev/mock/scenarios.ts`.
3. A new REST endpoint goes through `src/core/ado.ts` and needs a handler in `dev/mock/api.ts`.
4. Run `npm run check` (typecheck, unit and e2e tests) before pushing. CI runs the same checks on every pull request.

UI text is in English. By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE).
