# Tele-AutoUpload

A Telegram media ingestion pipeline that automatically downloads photos and videos sent to a Telegram group and uploads them to Google Drive.
Documents and the precise supported flow are described in the [media specification](specs/media-ingestion.md).

## Start here

- Agents: [AGENTS.md](AGENTS.md).
- Runtime and process map: [architecture](docs/reference/architecture.md).
- Current limits and unresolved choices: [status](docs/status.md).
- Documentation provenance and proposed deletions: [migration map](docs/migration-map.md).

## Prerequisites

Use the Node version declared by [package.json](package.json) and [.nvmrc](.nvmrc).
Provide PostgreSQL, Redis, a Telegram bot with a local Bot API server and credentials for the selected upload strategy. Media capture and downloads need no human Telegram session.
[Compose](docker-compose.yml) defines local Redis/PostgreSQL services; it does not start the applications.
The frontend has its own [package manifest](apps/web-admin/package.json) and dependency installation.

## Setup

1. Install dependencies for both package manifests using your package manager.
2. Configure a local environment from [.env.example](.env.example); the [environment reference](docs/reference/environment.md) lists required values and defaults.
3. Generate the Prisma client and apply development migrations:

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. Configure the local Bot API server and shared cache using [bot setup and cutover](docs/reference/operations.md#bot-setup-and-cutover). Add the bot manually to your database-registered source groups and grant visibility of ordinary media. The server needs application credentials from [Telegram API development tools](https://my.telegram.org), but no human session. The optional account session utility is only for explicitly enabled legacy campaigns and username lookup.

5. Configure admin authentication and register active users through the admin UI or [target API](docs/reference/api.md).
6. Start each needed application in a separate terminal:

```bash
npm run start:ingestor
npm run start:downloader
npm run start:uploader
npm run start:stats
npm run start:web
```

Consult [script caveats](docs/reference/scripts.md) before using the combined development commands.
For supervised backend processes, use [PM2 operations](docs/reference/operations.md).

## Verification and lookup

[Scripts](docs/reference/scripts.md) lists the backend/frontend builds and tests.
[API contracts](docs/reference/api.md), [environment](docs/reference/environment.md), and [operations](docs/reference/operations.md) contain lookup material.
[Specifications](specs/INDEX.md) describe current product behavior.
Keep credentials outside tracked files; the environment-file exclusions are in [.gitignore](.gitignore).
