# Script reference

## Runtime and command provenance

The backend [manifest](../../package.json) declares Node >=22; [.nvmrc](../../.nvmrc) selects v22.
Run root commands from the repository root. The frontend is a separate package with its own dependency installation.
Tables below are extracted from the manifests; listing a command is not a claim it was executed successfully.
Shell setup/install/database-administration commands outside those manifests are not prescribed here.

## Root scripts

| Script | Configured command |
| --- | --- |
| `build` | `tsc -p tsconfig.build.json` |
| `build:web` | `npm --prefix apps/web-admin run build` |
| `start:ingestor` | `ts-node apps/ingestor/src/main.ts` |
| `start:downloader` | `ts-node apps/worker-downloader/src/main.ts` |
| `start:uploader` | `ts-node apps/worker-uploader/src/main.ts` |
| `start:stats` | `ts-node apps/stats-api/src/main.ts` |
| `start:web` | `npm --prefix apps/web-admin run dev` |
| `pm2:start` | `pm2 startOrRestart ecosystem.config.cjs --update-env` |
| `pm2:reload` | `pm2 reload ecosystem.config.cjs --update-env` |
| `pm2:status` | `pm2 status` |
| `pm2:logs` | `pm2 logs` |
| `prod` | `npm run pm2:start && pm2 logs` |
| `tg:session` | `tsx scripts/generate-session.ts` |
| `prisma:generate` | `prisma generate` |
| `prisma:migrate` | `prisma migrate dev` |
| `prisma:seed` | `tsx prisma/seed.ts` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `dev` | `concurrently -n ingestor,downloader,uploader,stats -c blue,magenta,yellow,cyan "npm:start:*"` |
| `dev:all` | `concurrently -n ingestor,downloader,uploader,stats,web -c blue,magenta,yellow,cyan,green "npm:start:*" "npm run start:web"` |

## Frontend scripts

These script names belong to [the frontend manifest](../../apps/web-admin/package.json), not the root package.

| Script | Configured command |
| --- | --- |
| `dev` | `vite` |
| `build` | `vue-tsc -b && vite build` |
| `preview` | `vite preview` |

## Build and test scope

The backend build emits application/shared TypeScript and excludes tests and web admin via [tsconfig.build.json](../../tsconfig.build.json).
The frontend build runs vue-tsc followed by Vite using its [own configuration](../../apps/web-admin/tsconfig.json).
Vitest selects root tests/**/*.spec.ts and resolves the shared alias using [vitest.config.ts](../../vitest.config.ts).
There is no lint script in either manifest and no tracked lint/CI configuration in this checkout.
Tests importing appConfig parse configuration at import time. [Vitest](../../vitest.config.ts) supplies dummy bot, database, Redis, staging and desktop-strategy settings so the suite does not need production credentials; environment-specific cases extend/reset their own values.

## Documentation checks

The following commands are run during this migration:

```bash
npm test -- tests/documentation.spec.ts
git diff --check
```

The [focused test](../../tests/documentation.spec.ts) checks local Markdown links, reference definitions, Markdown fragments, CLAUDE imports, routing equality and agent budgets.
It does not access external URLs, inspect runtime service behavior or automatically regenerate inventories.
No generator script or manifest change is included in this documentation-only migration.

## Development orchestration caveat

The combined-script issue is recorded in [status](../status.md); use individually named scripts from the root manifest when you need explicit process selection.
The installed concurrently wildcard expansion is the basis for the observed script-selection issue; no development servers are started by the documentation checks.

## Sources

Command inventory extracted from package manifests; PM2/setup descriptions consolidated from README and [requirements](../../requirement.md).
