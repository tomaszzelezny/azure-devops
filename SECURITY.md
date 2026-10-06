# Security policy

[![Security scan](https://github.com/tomaszzelezny/azure-devops/actions/workflows/security.yml/badge.svg)](https://github.com/tomaszzelezny/azure-devops/actions/workflows/security.yml)

Aging WIP runs in the browser inside Azure DevOps, reads work items with the signed-in user's own permissions and never writes to Azure DevOps (see [PRIVACY.md](PRIVACY.md)). Still, if you find a way it could leak data or be abused, please tell me privately.

## Automated scanning

Every pull request, every merge to `main` and a weekly run scan the repository with [Trivy](https://trivy.dev): known vulnerabilities in the npm dependencies (development tools included), committed secrets and misconfigurations. Results are listed under the repository's [Security → Code scanning](https://github.com/tomaszzelezny/azure-devops/security/code-scanning) tab; a fixable HIGH or CRITICAL finding fails the build.

## Reporting a vulnerability

Use **[Report a vulnerability](https://github.com/tomaszzelezny/azure-devops/security/advisories/new)** (GitHub private vulnerability reporting). Please don't open a public issue for security problems.

Include what you found, how to reproduce it, and the extension version. I'll reply as soon as I can and credit you in the fix unless you'd rather not be named.

## Supported versions

Only the latest version published on the Visual Studio Marketplace gets fixes.
