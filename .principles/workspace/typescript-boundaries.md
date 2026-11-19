# TypeScript boundaries

## Rule

- Preserve strict compilation and the separate backend/frontend module configurations.
- Keep shared backend imports compatible with the configured alias and runtime registration.
- Add shared injectable providers/exports through SharedModule when required by consumers.
- Match role-suffixed backend filenames and existing Vue page conventions when extending those areas.
- Do not invent a lint gate or an explicit-any prohibition that the repository does not configure.

## Why

Backend runtime resolution and frontend bundling differ. A typechecked alias still needs the existing runtime registration; provider registration controls Nest injection.

## Enforcement

Compiler: [root tsconfig](../../tsconfig.json), [backend build config](../../tsconfig.build.json), [frontend config](../../apps/web-admin/tsconfig.json).
Runtime/test resolution: [PM2 configuration](../../ecosystem.config.cjs), [Vitest alias](../../vitest.config.ts), [shared module](../../packages/shared/src/services/shared.module.ts).
Naming and provider-change review: review only.
The runtime constraint comes from [package.json](../../package.json), not the older requirements recommendation.
