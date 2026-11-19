# Guardrails

- Never change attachment identity without preserving [message-slot replay behavior](code/media-lifecycle.md).
- Never resurrect terminal deleted media during [replay or recovery](code/media-lifecycle.md).
- Never discard a durable download because [upload handoff failed](code/media-lifecycle.md).
- Never finalize a download without its [current ownership token](code/media-lifecycle.md).
- Never checkpoint unprocessed history or proceed after [reconciliation ownership is lost](code/reconciliation.md).
- Never bypass the shared gate in operations that [currently depend on it](code/telegram-access.md).
- Never round target/resolver Telegram user IDs through [JavaScript Number](code/api-boundaries.md).
- Never save a target or overwrite its chat ID during [explicit username lookup](code/api-boundaries.md).
- Never remove authentication from [existing guarded admin routes](code/api-boundaries.md).
- Never commit changes without [explicit user instruction](workspace/change-scope.md).
