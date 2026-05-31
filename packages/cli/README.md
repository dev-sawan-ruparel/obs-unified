# @obs-unified/cli

Command-line entry point for [obs-unified](https://github.com/obs-unified/obs-unified).

```bash
obs-unified up                       # spin up the repo-local collector stack
pnpm dlx @obs-unified/cli create my-app   # scaffold an app
pnpm dlx @obs-unified/cli doctor     # diagnose a collector
```

## Commands

| Command | Purpose |
| --- | --- |
| `obs-unified up` | `docker compose up` against the repo-local Postgres+MinIO+collector stack |
| `obs-unified down` | tear down |
| `obs-unified create <name>` | scaffold a new app from React+Hono, vanilla frontend, or Workers API templates |
| `obs-unified keys mint` | mint a new ingest key on a running collector |
| `obs-unified keys list` | list keys |
| `obs-unified doctor [url] [--origin <origin>]` | smoke-test a collector — health, browser ingest CORS, OTLP, dashboard API |

## Environment

- `OBS_COLLECTOR_URL` — default for `keys` and `doctor` (otherwise `http://localhost:8790`).
- `OBS_DOCTOR_ORIGINS` — comma-separated origins to test during `doctor` CORS checks (defaults to `http://localhost:5173,http://localhost:8080`).
- `OBS_ADMIN_TOKEN` — required for `keys` subcommands.

## Instrument An Existing App

The CLI intentionally does not patch existing applications yet. Choose your
language/framework and start from the matching example:

- React/Vite + Hono: `docs/howto/instrument-react-hono.md`
- Browser-only: `packages/analytics-sdk/README.md`
- TypeScript backend: `packages/telemetry-sdk/README.md`
- Other languages: `docs/recipes/README.md`

After wiring, run `obs-unified doctor [url] --origin <app-origin>` to verify the
collector and browser CORS path.
