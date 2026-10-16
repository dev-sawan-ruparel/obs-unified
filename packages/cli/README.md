# @obsunified/cli

Command-line entry point for
[obs-unified](https://github.com/dev-sawan-ruparel/obs-unified).

```bash
obs-unified up                       # spin up the repo-local collector stack
pnpm dlx @obsunified/cli create my-app --template react-vite --yes   # scaffold non-interactively
pnpm dlx @obsunified/cli doctor     # diagnose a collector
```

## Commands

| Command                                                   | Purpose                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `obs-unified up [--compose-file <path>]`                  | `docker compose up -d` against the repo's Postgres+RustFS+collector stack (see [up / down](#up--down)) |
| `obs-unified down [--compose-file <path>]`                | `docker compose down`; keeps volumes (`down -v` wipes them)                    |
| `obs-unified create <name> [--template <t>] [--collector-url <url>] [--ingest-key <key>] [--yes]` | scaffold a new app (`react-vite`, `vanilla-ts`, `hono-workers`); skips prompts with `--yes` or in non-TTY shells |
| `obs-unified keys mint [--project <id>] [--name <label>] [--json]` | mint a new ingest key for a project on a running collector            |
| `obs-unified keys list [--project <id>] [--json]`         | list a project's ingest keys                                                   |
| `obs-unified keys revoke <keyId> [--project <id>] [--json]` | revoke an ingest key (auth cache: up to 60 s, see below)                     |
| `obs-unified changes record --service <name> [options]`   | record a release/config/feature-flag change event (`POST /v1/changes`)         |
| `obs-unified changes list [options]`                      | list recent change events (`GET /internal/changes`)                            |
| `obs-unified doctor [url] [--origin <origin>]`            | smoke-test a collector — health, browser ingest CORS, OTLP, dashboard API      |

`obs-unified --version` prints the CLI version; `<command> --help` works for
`keys` and `doctor`.

## up / down

`up` and `down` wrap `docker compose` and need a compose file: run them from the
obs-unified repo root (they look for `apps/collector-node/docker-compose.yml`,
then `docker-compose.yml`, then `compose.yml`) or pass `--compose-file <path>`.
Installed from npm outside the repo, they exit with an error unless you pass
one.

The stack binds host ports **5432** (Postgres), **8790** (collector), **9000**
and **9001** (RustFS S3 and console); free them first. The dashboard is
separate (`pnpm dev:web`, <http://localhost:5173>).

`down` stops and removes the containers but **keeps the volumes**, so data
survives a restart. Use `docker compose -f <file> down -v` to wipe the data.

## Scaffolding

`create` copies a template, writes the collector URL, and, with
`--ingest-key <key>`, the ingest key. Without the flag it falls back to the
`OBS_INGEST_KEY` environment variable; in a terminal without `--yes` it then
prompts for the key (Enter keeps the placeholder). Otherwise the key is the
placeholder `dev-ingest-key`. The "Next steps" output says which source was used
and which variables to set. `obs-unified create --help` prints usage.

| Template       | Where the key goes                                                          |
| -------------- | --------------------------------------------------------------------------- |
| `react-vite`   | `.env.local`: `VITE_OBS_INGEST_KEY` (browser) and `OBS_INGEST_KEY` (API; `dev:api` loads `.env.local`) |
| `vanilla-ts`   | `.env.local`: `VITE_OBS_INGEST_KEY`                                         |
| `hono-workers` | `.dev.vars`: `OBS_INGEST_KEY` for local dev; `wrangler secret put OBS_INGEST_KEY` in production |

The dashboard is at <http://localhost:5173>; the collector URL is the API.

## Ingest keys

`keys` talks to the collector's project routes with
`Authorization: Bearer $OBS_ADMIN_TOKEN`, where `OBS_ADMIN_TOKEN` is the same
value as the collector's `DASHBOARD_TOKEN`:

| Command     | Request                                                   | Response                                                     |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| `keys mint` | `POST /internal/projects/<id>/keys` with JSON `{ name }`  | `201` ingest key record plus the one-time plaintext `key`    |
| `keys list` | `GET /internal/projects/<id>/keys`                        | `200 { keys: [...] }` — id, name, key prefix, created, revoked |
| `keys revoke <keyId>` | `DELETE /internal/projects/<id>/keys/<keyId>`   | `200` on success; the key id comes from `keys list`          |

Which project `<id>` is used, first match wins:

1. `--project <id>` (or `-p`)
2. `OBS_PROJECT_ID`
3. Discovery via `GET /internal/projects`: the collector's `default` project
   (every collector seeds one), otherwise its only project. If several
   non-default projects exist the CLI prints their ids and asks for
   `--project` rather than guessing.

```bash
export OBS_COLLECTOR_URL=http://localhost:8790
export OBS_ADMIN_TOKEN=<collector DASHBOARD_TOKEN>

obs-unified keys mint --name browser        # default project
obs-unified keys mint --project 3f9c… --json
obs-unified keys list
obs-unified keys revoke <keyId>
```

**Revocation delay:** the collector caches ingest-key authorization for up to
60 seconds, so a revoked key can keep ingesting for up to a minute after
`keys revoke` succeeds.

`keys mint` prints the plaintext key on its own line; the collector never shows
it again. Failures are reported distinctly: a rejected token (HTTP 401/403), an
unknown project (`Project not found`), or an unknown route (HTTP 404 — the URL
is not an obs-unified collector, or the collector predates project routes).

## Environment

- `OBS_COLLECTOR_URL` — default for `keys`, `changes`, `doctor`, and `create`
  (otherwise `http://localhost:8790`).
- `OBS_ADMIN_TOKEN`, `OBS_API_TOKEN`, `OBS_DASHBOARD_TOKEN` — interchangeable
  bearer tokens for every read/admin command (`keys`, `changes list`,
  `doctor`); the first one set wins, in the order `OBS_API_TOKEN`,
  `OBS_ADMIN_TOKEN`, `OBS_DASHBOARD_TOKEN`. `OBS_DASHBOARD_TOKEN` works
  everywhere the others do. The value must equal the collector's
  `DASHBOARD_TOKEN`; the CLI sends it as `Authorization: Bearer <token>`.
  Required for `keys` and `changes list`; optional for `doctor`, where it is
  sent on the dashboard read-API probe (`GET /internal/projects`) and must be
  accepted. Without it, `doctor` expects a `401` from that probe; a `200`
  without credentials is reported as a failed check because the internal API is
  exposed unauthenticated.
- `OBS_INGEST_KEY`, `OBS_API_KEY` — ingest key for `changes record` (the first
  one set wins; `--api-key` overrides).
- `OBS_PROJECT_ID` — project for `keys` when `--project` is omitted.
- `OBS_DOCTOR_ORIGINS` — comma-separated origins to test during `doctor` CORS
  checks (defaults to `http://localhost:5173`; `--origin` replaces the list).

## Instrument An Existing App

The CLI intentionally does not patch existing applications yet. Choose your
language/framework and start from the matching example:

- React/Vite + Hono: `docs/howto/instrument-react-hono.md`
- Browser-only: `packages/analytics-sdk/README.md`
- TypeScript backend: `packages/telemetry-sdk/README.md`
- Other languages: `docs/recipes/README.md`

After wiring, run `obs-unified doctor [url] --origin <app-origin>` to verify the
collector and browser CORS path.
