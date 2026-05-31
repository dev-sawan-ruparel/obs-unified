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
| `obs-unified create <name>` | scaffold a new app — picks framework + backend interactively |
| `obs-unified keys mint` | mint a new ingest key on a running collector |
| `obs-unified keys list` | list keys |
| `obs-unified doctor [url] [--origin <origin>]` | smoke-test a collector — health, browser ingest CORS, OTLP, dashboard API |

## Environment

- `OBS_COLLECTOR_URL` — default for `keys` and `doctor` (otherwise `http://localhost:8790`).
- `OBS_DOCTOR_ORIGINS` — comma-separated origins to test during `doctor` CORS checks (defaults to `http://localhost:5173,http://localhost:8080`).
- `OBS_ADMIN_TOKEN` — required for `keys` subcommands.
