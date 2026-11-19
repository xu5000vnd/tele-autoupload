# Web admin guide

## Scope

Applies to this app and its descendants. Start with the [root guide](../../AGENTS.md).
Use the [router](src/main.ts), [pages](src/pages) and [API client](src/services/api.ts) for ownership.

## Read before changing

| Area | Read |
| --- | --- |
| Compilation and imports | [TypeScript boundaries](../../.principles/workspace/typescript-boundaries.md) |
| HTTP contracts, authentication or username form behavior | [API boundaries](../../.principles/code/api-boundaries.md), [API reference](../../docs/reference/api.md) |
| Cycle displays or date interpretation | [Reporting time](../../.principles/code/reporting-time.md) |
| Local proxy, build or deployment | [Environment](../../docs/reference/environment.md), [scripts](../../docs/reference/scripts.md), [operations](../../docs/reference/operations.md) |

## Verification

Use the frontend build from [scripts](../../docs/reference/scripts.md).
There is no component-test script in [this manifest](package.json); report browser checks separately if performed.
Follow [verification](../../.principles/quality/verification.md) and [docs-sync](../../.principles/practice/docs-sync.md).
