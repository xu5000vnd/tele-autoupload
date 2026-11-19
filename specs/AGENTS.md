# Specification guide

## Scope

Start with the [root guide](../AGENTS.md). This folder owns current product behavior and explicitly confirmed requirements.
The [index](INDEX.md) identifies each specification and its implementation sources.

## Editing specifications

- Describe supported behavior in present tense; keep API tables and environment inventories in [reference](../docs/reference).
- Keep technical invariants in [principles](../.principles/README.md).
- Do not promote a source-plan proposal to a requirement without confirmation.
- Put inferred intent and unresolved choices in [status](../docs/status.md), marked "to confirm".
- Preserve source coverage in the [migration map](../docs/migration-map.md); do not delete retained source documents without review.
- Do not add ticket chronology; use Git and the tracker for history.

## Verification

Follow [documentation synchronization](../.principles/practice/docs-sync.md) and the [script reference](../docs/reference/scripts.md).
Compare changed acceptance statements with source behavior; the documentation test checks structure, not product semantics.
