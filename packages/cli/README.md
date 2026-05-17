# @obs-unified/cli

Command-line entry point for [obs-unified](https://github.com/obs-unified/obs-unified).

```bash
pnpm dlx @obs-unified/cli up         # spin up local stack
pnpm dlx @obs-unified/cli create my-app   # scaffold an app
pnpm dlx @obs-unified/cli doctor     # diagnose a collector
```

## Commands

| Command | Purpose |
| --- | --- |
| `obs-unified up` | `docker compose up` against the local Postgres+MinIO+collector stack |
| `obs-unified down` | tear down |
| `obs-unified create <name>` | scaffold a new app — picks framework + backend interactively |
| `obs-unified keys mint` | mint a new ingest key on a running collector |
| `obs-unified keys list` | list keys |
| `obs-unified doctor [url]` | smoke-test a collector — health, OTLP, dashboard API |

## Environment

- `OBS_COLLECTOR_URL` — default for `keys` and `doctor` (otherwise `http://localhost:8790`).
- `OBS_ADMIN_TOKEN` — required for `keys` subcommands.
