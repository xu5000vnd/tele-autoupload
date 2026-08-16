# Telegram Username-to-User-ID Resolution — Implementation Plan

## Goal

Allow an authenticated web-admin user to enter a public Telegram username and explicitly resolve it to a numeric Telegram user ID before creating or updating a `user_tu` record.

The feature reuses the project's existing signed-in GramJS MTProto client. It does not use the Telegram Bot API and does not add a second Telegram library.

## Decisions

| Decision | Chosen behavior |
| --- | --- |
| Resolution mechanism | GramJS `Api.contacts.ResolveUsername` through the shared `TelegramGateway`. |
| API access | Authenticated with the existing `BearerAuthGuard`, the same as target CRUD. |
| User action | An explicit **Resolve** button in the Users form. No lookup while typing and no automatic save. |
| Returned ID format | Decimal string at the HTTP/UI boundary; never serialize a JavaScript `bigint`. |
| `telegram_chat_id` | Never derive, populate, or overwrite it. The admin still supplies the upload group/chat ID. |
| Persistence | The lookup endpoint is read-only. The existing Create/Update User action remains the only persistence path. |
| Schema/config/dependencies | No Prisma migration, environment variable, or npm dependency is required. |

`UserTu.telegramChatId` is the group or supergroup in which the uploader is authorized. The repository's existing examples use a negative group ID and a positive sender user ID. A username identifies the sender, not that group context.

## Scope

### In scope

- Resolve a currently public username, with or without a leading `@`.
- Accept only Telegram results whose peer is `Api.PeerUser`.
- Fill the existing Users form's `telegram_user_id` field from the resolved ID.
- Return safe, user-facing errors without exposing Telegram RPC details, session data, or profile data.
- Reuse the existing global Telegram request gate, including its FloodWait handling.

### Out of scope

- Resolving private accounts, display names, phone numbers, invite links, or contacts.
- Looking up channels, groups, or group chat IDs.
- Bulk lookup, scheduled lookup, caching, or automatic re-resolution when a username changes.
- Persisting an MTProto access hash, profile information, phone number, or raw Telegram peer object.
- Changing ingestion, reconciliation, `user_tu` matching, or existing manual ID entry.
- Interactive Telegram login from an HTTP request.

## Existing integration points

| Area | Current responsibility | Change |
| --- | --- | --- |
| `packages/shared/src/telegram/telegram-gateway.ts` | Owns the connected GramJS `TelegramClient` and routes Telegram requests through `TelegramRequestGate`. | Add one username-resolution method. |
| `apps/stats-api/src/messages.service.ts` | Owns target-related application logic and already injects `TelegramGateway`. | Add a read-only resolver service method and HTTP-error mapping. |
| `apps/stats-api/src/messages.controller.ts` | Provides authenticated `/api/messages/targets` CRUD. | Add the resolver route and request parsing. |
| `apps/web-admin/src/services/api.ts` | Provides authenticated browser API calls and target DTOs. | Add resolver request/response types and client function. |
| `apps/web-admin/src/pages/UsersPage.vue` | Edits `user_tu` records. | Add explicit resolution UI, loading state, and form autofill. |
| `tests/messages-controller.spec.ts` and new focused specs | Existing Vitest test location. | Add controller, service, and gateway tests. |

`MessagesService.onModuleInit()` already connects `TelegramGateway` with updates disabled. The resolver must depend on that lifecycle; it must not create a client or attempt an interactive login.

## API contract

### `POST /api/messages/targets/resolve-username`

The route is protected by the class-level `BearerAuthGuard` already applied to `MessagesController`.

Request:

```json
{
  "telegram_username": "@ExampleUser"
}
```

Successful response:

```json
{
  "telegram_username": "exampleuser",
  "telegram_user_id": "123456789"
}
```

Rules:

- Trim surrounding whitespace.
- Remove leading `@` characters and lowercase the remaining value, matching the existing target parser.
- Reject an empty normalized value with `400 Bad Request`.
- Return only the normalized username and decimal-string user ID.
- Do not return Telegram profile details, `access_hash`, session information, or raw RPC responses.
- Do not read or write Prisma data as part of this request.

### Error behavior

Use clear, non-sensitive messages. Log the original error only on the server with structured metadata.

| Situation | HTTP status | Client-safe message |
| --- | ---: | --- |
| Missing, non-string, or empty username | 400 | `telegram_username is required` / `telegram_username must be a string` |
| Telegram reports `USERNAME_INVALID` | 400 | `Telegram username is invalid` |
| Telegram reports `USERNAME_NOT_OCCUPIED` | 404 | `Telegram username was not found` |
| Username resolves to a group or channel | 422 | `Telegram username does not belong to a user` |
| Gateway is disconnected, session is unauthorized, or Telegram is unavailable | 503 | `Telegram username lookup is currently unavailable` |
| Telegram reports FloodWait | 429 | `Telegram is rate limited; try again later` |

The endpoint must not automatically retry failed requests. `TelegramRequestGate` already coordinates request spacing and FloodWait backoff across the application.

## Backend design

### 1. Add a narrow gateway method

In `packages/shared/src/telegram/telegram-gateway.ts`, add a public method with a transport-neutral return value, for example:

```ts
type ResolvedTelegramUser = {
  telegramUserId: bigint;
};

resolvePublicUserUsername(username: string): Promise<ResolvedTelegramUser>
```

Implementation requirements:

1. Require an existing connected client. If it is not connected, fail with a recognizable gateway-unavailable error; do not call `connect()` or `start()` from this method.
2. Call the existing private `runTelegramRequest(undefined, ...)` wrapper so this RPC shares the application's request rate, concurrency, and FloodWait behavior.
3. Invoke:

   ```ts
   this.client.invoke(new Api.contacts.ResolveUsername({ username }))
   ```

4. Verify `result.peer instanceof Api.PeerUser`. Reject `Api.PeerChat` and `Api.PeerChannel` as a semantic "not a user" outcome.
5. Defensively verify that `result.users` contains the matching `Api.User` for `result.peer.userId`. Treat a missing match as an unavailable/inconsistent Telegram response, not a successful lookup.
6. Convert GramJS's `BigInteger` ID with `BigInt(peer.userId.toString())`. Do not call `Number()` and do not return a raw `BigInteger` or `bigint` to HTTP code.
7. Keep the returned username normalized; normalization belongs at the API/service boundary so all callers receive the same value.

The method should not use `client.getEntity()` because this feature needs a strict `PeerUser` check and a controlled error contract around the raw `contacts.resolveUsername` RPC.

### 2. Add application-level error mapping

In `apps/stats-api/src/messages.service.ts`:

- Add `resolveTargetUsername(telegramUsername: string)`.
- Call `telegramGateway.resolvePublicUserUsername()`.
- Convert the result to:

  ```ts
  {
    telegram_username: normalizedUsername,
    telegram_user_id: telegramUserId.toString(),
  }
  ```

- Map known GramJS errors according to the table above. The gateway's exported `telegramFloodWaitSeconds()` helper can identify a FloodWait without exposing the original RPC error.
- Log unknown or infrastructure errors with the normalized username, operation name, RPC code/message when available, and the original error object. Return only the client-safe `503` message.

Keep Nest HTTP exceptions in the stats API service/controller layer rather than coupling `TelegramGateway` to HTTP response types.

### 3. Add the controller route

In `apps/stats-api/src/messages.controller.ts`:

- Add `POST targets/resolve-username` before the normal target-creation route.
- Parse `telegram_username` with the same normalization as target CRUD.
- Delegate to `MessagesService.resolveTargetUsername()`.
- Do not reuse `parseTargetBody()` because a resolver request deliberately does not require TU fields or either Telegram numeric ID.

The existing class-level `@UseGuards(BearerAuthGuard)` is sufficient. Do not add an unauthenticated route, a session token parameter, or a Telegram credential parameter.

## Web-admin behavior

In `apps/web-admin/src/pages/UsersPage.vue`:

1. Keep the existing Username, User ID, and Chat ID fields editable.
2. Add a **Resolve** button next to the Telegram Username field.
3. Add a `resolvingUsername` state and disable the Resolve button while the request is in flight or the normalized username is empty.
4. On success:
   - Set `form.telegram_username` to the normalized response username.
   - Set `form.telegram_user_id` to the response ID string.
   - Leave every other form field untouched, especially `form.telegram_chat_id`.
   - Show a brief success message such as `Resolved @exampleuser.`
5. On failure:
   - Preserve all form values.
   - Display the safe API error.
   - Do not save or close the modal.
6. Retain the normal Create/Update submit path. HTML required-field validation continues to require both `telegram_user_id` and `telegram_chat_id` before a target is saved.

In `apps/web-admin/src/services/api.ts`:

- Add `ResolveTelegramUsernameRequest` and `ResolveTelegramUsernameResponse` types using string IDs.
- Add `resolveTelegramUsername(payload)` that posts to the new route.
- Ensure API errors surfaced to `UsersPage` are readable text. If necessary, make the existing generic response helper parse a JSON error response's `message` field before falling back to raw text; do not expose a server stack or RPC message.

## Data and compatibility guarantees

- No schema or migration change: `UserTu.telegramUserId`, `telegramChatId`, and `username` already exist.
- Existing manual creation and updates remain supported.
- Existing username-only records with `telegram_user_id = 0` remain valid; this feature merely gives admins a way to fill the value before a user sends media.
- The ingestor's existing username-match-and-backfill behavior remains unchanged.
- IDs stay decimal strings in API and Vue state. Convert to `bigint` only through the existing controller/parser and Prisma write path.

## Implementation sequence

1. Add focused types and `resolvePublicUserUsername()` to `TelegramGateway`, reusing `runTelegramRequest`.
2. Add resolver-specific semantic errors or an equivalent typed result so the stats API can distinguish "not a user" from service failure without inspecting user-facing strings.
3. Add `MessagesService.resolveTargetUsername()` and map all expected gateway/RPC outcomes to Nest exceptions.
4. Add the guarded controller route and unit tests for input normalization/delegation.
5. Add the API-client types/function and the Users form's explicit Resolve interaction.
6. Run backend tests and the web-admin production build.
7. Perform a manual authenticated browser check against a controlled public username, then verify an invalid username and a public channel/group username.

## Test plan

### Backend unit tests

Add focused tests under `tests/` without a live Telegram call.

| Scenario | Expected result |
| --- | --- |
| ` @Alice ` | The RPC receives `alice`; API returns `telegram_username: "alice"`. |
| Resolved `Api.PeerUser` with matching `Api.User` | Returns the exact decimal-string ID, including an ID outside JavaScript's safe integer range. |
| Resolved `Api.PeerChannel` or `Api.PeerChat` | `422`; no target is written. |
| PeerUser but no matching user object | Safe unavailable/error response; no false success. |
| `USERNAME_INVALID` | `400` with the safe message. |
| `USERNAME_NOT_OCCUPIED` | `404` with the safe message. |
| FloodWait | `429`; raw RPC error is not sent to the client. |
| Disconnected or failed gateway | `503`; no interactive login attempt. |
| Controller request with missing/blank/non-string username | `400`; service is not called for invalid input. |
| Valid controller request | Service receives the normalized username and response ID remains a string. |

Use mocks/stubs for `TelegramGateway` or its client invocation. The test suite must not load real Telegram credentials or invoke Telegram's network.

### UI verification

The web-admin currently has no component-test harness. Do not introduce one solely for this control in this change. Verify with the existing production build and a manual flow:

1. Open **Users** and start a new user or edit an existing one.
2. Enter a known public username and click **Resolve**.
3. Confirm only Telegram Username and Telegram User ID change; Telegram Chat ID remains unchanged.
4. Confirm the form is not saved automatically.
5. Save with a valid group chat ID and confirm the normal target API persists the returned user ID.
6. Repeat with an invalid username and a channel/group username; confirm the form remains intact and the error is understandable.

## Verification commands

```bash
npm test
npm run build
npm run build:web
git diff --check
```

## Acceptance criteria

- An authenticated admin can resolve a valid public `@username` to the correct Telegram user ID before saving a target.
- The username is normalized consistently with current target CRUD.
- The endpoint cannot resolve channel/group IDs as user IDs and does not expose Telegram credentials or raw RPC data.
- The resolver changes only the Users form's username and user-ID fields; it never changes `telegram_chat_id` or persists automatically.
- Existing target CRUD, schema, ingestion, and manual numeric-ID workflow continue to work unchanged.
- Error cases produce the documented HTTP statuses and safe messages.
- Backend tests, TypeScript builds, and the manual UI checks pass.
