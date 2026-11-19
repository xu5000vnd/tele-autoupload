# Agent guide

## Repository

Tele-AutoUpload is a Telegram media pipeline with a NestJS backend and a Vue admin UI.
Read the [architecture](docs/reference/architecture.md) for processes and communication.
This file is the canonical entry point for every agent harness; scoped guides add local routing.
Read [current problems and unresolved decisions](docs/status.md) before relying on an operational guarantee.

## Layout

- [apps](apps): ingestor, downloader, uploader, stats API and web admin.
- [packages/shared](packages/shared): shared configuration, persistence, queues, Telegram and Drive integration.
- [prisma](prisma): schema, migrations and seed.
- [tests](tests): existing Vitest specifications and the documentation check.
- [scripts](scripts): Telegram session utility.
- [.principles](.principles/README.md): implementation rules and evidence.
- [docs/reference](docs/reference): lookup material; [specs](specs/INDEX.md): current product behavior.

## Commands

Run commands from the repository root with the runtime declared in [package.json](package.json).
The [script reference](docs/reference/scripts.md) owns the complete command inventory and caveats.

| Purpose | Command |
| --- | --- |
| Backend build | `npm run build` |
| Frontend build | `npm run build:web` |
| Existing test suite | `npm test` |
| Documentation check | `npm test -- tests/documentation.spec.ts` |
| Whitespace check | `git diff --check` |

## Doing X → read Y

<!-- routing:start -->
| Doing X | Read Y |
| --- | --- |
| Planning or editing any change | [Change scope][scope], [guardrails][guardrails] |
| Changing TypeScript or runtime settings | [TypeScript boundaries][typescript] |
| Changing media discovery, download or recovery | [Shared module guide][shared], [media lifecycle][media] |
| Changing history replay or checkpoints | [Reconciliation][reconciliation] |
| Changing Telegram access or username lookup | [Telegram access][telegram], [API boundaries][api-rules] |
| Changing admin HTTP behavior | [Stats API guide][stats], [API reference][api] |
| Changing reporting or reminders | [Reporting time][reporting], [Stats API guide][stats] |
| Changing Vue pages or browser API calls | [Web admin guide][web] |
| Changing startup, shutdown or process configuration | [Process lifecycle][lifecycle], [operations][operations] |
| Changing product requirements | [Specification guide][spec-guide], [specification index][spec-index], [status][status] |
| Verifying or documenting a change | [Verification][verification], [documentation sync][docs-sync] |
<!-- routing:end -->

## Before you say a change is done

- Confirm the requested scope and the current working branch; follow [change policy][scope].
- Read the relevant routing entry and its source evidence.
- Check [known problems][status]; do not describe desired behavior as implemented.
- Run checks appropriate to the affected area using [verification guidance][verification].
- Follow the [documentation sync table][docs-sync].
- For documentation, verify links, routing equality, agent line budgets and changed factual claims.
- Report which checks ran, their results, remaining uncertainty and any checks not run.
- Review the diff for unrelated edits; do not commit without explicit instruction.

Retained source documents are listed in the [migration map](docs/migration-map.md).
They are review inputs, not agent instructions.

[scope]: .principles/workspace/change-scope.md
[guardrails]: .principles/guardrails.md
[typescript]: .principles/workspace/typescript-boundaries.md
[shared]: packages/shared/AGENTS.md
[media]: .principles/code/media-lifecycle.md
[reconciliation]: .principles/code/reconciliation.md
[telegram]: .principles/code/telegram-access.md
[api-rules]: .principles/code/api-boundaries.md
[stats]: apps/stats-api/AGENTS.md
[api]: docs/reference/api.md
[reporting]: .principles/code/reporting-time.md
[web]: apps/web-admin/AGENTS.md
[lifecycle]: .principles/delivery/process-lifecycle.md
[operations]: docs/reference/operations.md
[spec-guide]: specs/AGENTS.md
[spec-index]: specs/INDEX.md
[status]: docs/status.md
[verification]: .principles/quality/verification.md
[docs-sync]: .principles/practice/docs-sync.md
