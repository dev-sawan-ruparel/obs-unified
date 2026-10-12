# @obsunified/cli

Command-line entry point for
[obs-unified](https://github.com/dev-sawan-ruparel/obs-unified).

```bash
obs-unified up                       # spin up the repo-local collector stack
pnpm dlx @obsunified/cli create my-app   # scaffold an app
pnpm dlx @obsunified/cli doctor     # diagnose a collector
```

## Commands

| Command                                                   | Purpose                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `obs-unified up`                                          | `docker compose up` against the repo-local Postgres+MinIO+collector stack      |
| `obs-unified down`                                        | tear down                                                                      |
| `obs-unified create <name>`                               | scaffold a new app from React+Hono, vanilla frontend, or Workers API templates |
| `obs-unified keys mint [--project <id>] [--name <label>] [--json]` | mint a new ingest key for a project on a running collector            |
| `obs-unified keys list [--project <id>] [--json]`         | list a project's ingest keys                                                   |
| `obs-unified doctor [url] [--origin <origin>]`            | smoke-test a collector — health, browser ingest CORS, OTLP, dashboard API      |

## Ingest keys

`keys` talks to the collector's project routes with
`Authorization: Bearer $OBS_ADMIN_TOKEN`, where `OBS_ADMIN_TOKEN` is the same
value as the collector's `DASHBOARD_TOKEN`:

| Command     | Request                                                   | Response                                                     |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| `keys mint` | `POST /internal/projects/<id>/keys` with JSON `{ name }`  | `201` ingest key record plus the one-time plaintext `key`    |
| `keys list` | `GET /internal/projects/<id>/keys`                        | `200 { keys: [...] }` — id, name, key prefix, created, revoked |

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
```

`keys mint` prints the plaintext key on its own line; the collector never shows
it again. Failures are reported distinctly: a rejected token (HTTP 401/403), an
unknown project (`Project not found`), or an unknown route (HTTP 404 — the URL
is not an obs-unified collector, or the collector predates project routes).

## Environment

- `OBS_COLLECTOR_URL` — default for `keys` and `doctor` (otherwise
  `http://localhost:8790`).
- `OBS_ADMIN_TOKEN` — required for `keys`; optional for `doctor`. Its value
  must equal the collector's `DASHBOARD_TOKEN` (the server-side bearer token
  the collector's auth layer checks on `/internal/*`); the CLI sends it as
  `Authorization: Bearer <token>`. For `doctor` it is sent on the dashboard
  read-API probe (`GET /internal/projects`) and must be accepted. Without it,
  `doctor` expects a `401` from that probe; a `200` without credentials is
  reported as a failed check because the internal API is exposed
  unauthenticated.
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
