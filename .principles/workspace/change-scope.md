# Change scope

## Rule

- Work from current files, inspect the current diff, and preserve unrelated user work.
- Make surgical changes matching existing style; remove only orphans introduced by the change.
- Use the current branch unless the user explicitly requests a new branch.
- Do not commit without explicit user instruction.
- Do not create unit-test files by default in this legacy project; a specific user request can authorize a focused new test.
- State assumptions and verification criteria before a multi-step change.

## Why

Unrelated cleanup, branch changes and unrequested commits make review and recovery harder. Explicit task instructions take precedence over these working defaults.

## Enforcement

Review only: user-supplied AGENTS instructions in this conversation.
The user explicitly authorizes a new branch and one documentation test for this migration.
No tracked CI or Git hook is claimed to enforce these policies.
See [verification](../quality/verification.md) and [the migration review](../../docs/migration-map.md).
