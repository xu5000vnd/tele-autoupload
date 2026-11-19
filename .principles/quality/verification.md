# Verification

## Rule

- Define success criteria for the requested change and run checks appropriate to affected behavior.
- Distinguish passed checks, failed checks, static inspection and checks not run.
- For documentation, run the focused documentation test and inspect the diff; spot-check changed claims against source.
- For implementation work, use the existing tests and affected backend/frontend builds listed in the script reference.
- Do not claim CI, lint, coverage thresholds, live integration testing or browser verification without evidence.

## Why

A passing mocked service test does not establish real Telegram/Drive behavior. Accurate reporting keeps reviewers from relying on checks that did not happen.

## Enforcement

Existing checks: [scripts reference](../../docs/reference/scripts.md), [Vitest configuration](../../vitest.config.ts), [documentation test](../../tests/documentation.spec.ts).
[Queue tests](../../tests/queue-service.spec.ts) mock Redis/BullMQ; [media tests](../../tests/media-service.spec.ts) also exercise temporary files.
The backend production build excludes tests; Vitest execution alone is not a full TypeScript test-source check.
No tracked CI workflow, lint configuration or coverage threshold is present in the surveyed checkout.
Scope selection and truthful reporting: user-confirmed policy, review only.
