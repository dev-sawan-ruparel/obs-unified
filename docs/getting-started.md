# Getting Started

This page is the first-run path from a fresh repo checkout to seeing data in the
dashboard.

## Pick A Track

| If you want to... | Use this path |
| --- | --- |
| See the dashboard quickly without Docker demo traffic | [Track A — local repo + synthetic data](#track-a--local-repo--synthetic-data) |
| See realistic microservice traffic | [Track B — Astronomy Shop demo](#track-b--astronomy-shop-demo) |
| Add obs-unified to your own app | [Track C — instrument your app](#track-c--instrument-your-app) |

## Prerequisites

- Node.js 22+
- pnpm 10+
- Docker only for Track B or the standalone Node collector

## Track A — Local Repo + Synthetic Data

Use this when you want to see the product quickly.

```bash
git clone https://github.com/obs-unified/obs-unified.git
cd obs-unified
pnpm install
pnpm run setup
pnpm run dev
```

In another terminal:

```bash
pnpm run seed
```

Open:

- Dashboard: `http://localhost:5173`
- Demo API: `http://localhost:8787`
- Collector: `http://localhost:8790`

Expected result: Traces, Logs, AI Calls, Usage, and Issues should have sample
data. Replays require browser interaction, so open the Playground tab and click
the replay control once.

## Track B — Astronomy Shop Demo

Use this when you want realistic microservice traffic and service-map edges.

```bash
pnpm demo:setup
pnpm demo:preflight
pnpm dev:collector
```

In another terminal:

```bash
pnpm demo:up
```

Open:

- Dashboard: `http://localhost:5173`
- Shop frontend: `http://localhost:8080`

Expected result: after roughly 30 seconds, the load generator starts driving
traffic. Traces, Service Map, Issues, Logs, and Metrics should populate from the
OpenTelemetry demo.

Tear down:

```bash
pnpm demo:down
```

## Track C — Instrument Your App

Start by choosing your language/framework:

| App shape | Start here |
| --- | --- |
| React/Vite frontend + Hono API | [`docs/howto/instrument-react-hono.md`](./howto/instrument-react-hono.md) |
| Python Flask API | [`docs/howto/instrument-python-flask.md`](./howto/instrument-python-flask.md) |
| Browser-only app | [`packages/analytics-sdk/README.md`](../packages/analytics-sdk/README.md) |
| TypeScript backend | [`packages/telemetry-sdk/README.md`](../packages/telemetry-sdk/README.md) |
| Python, JVM, .NET, Go, Rust | [`docs/recipes/README.md`](./recipes/README.md) |
| Not sure yet | [`docs/examples.md`](./examples.md) |

The common wiring is:

1. Run or deploy a collector.
2. Add the browser/backend SDK or language recipe.
3. Set `OBS_COLLECTOR_URL` and a write-only ingest key.
4. Allow `x-obs-interaction` in browser-facing CORS.
5. Verify the collector path.

```bash
obs-unified doctor http://localhost:8790 --origin http://localhost:5173
```

For browser examples, use the origin of the app you are testing. For the
Astronomy Shop demo, use `http://localhost:8080`.

## Standalone Node Collector

If you only want a local collector backed by Postgres + MinIO:

```bash
cd apps/collector-node
docker compose up -d
docker compose logs -f collector
```

Collector defaults:

- Collector URL: `http://localhost:8790`
- Ingest key: `dev-ingest-key`
- Dashboard password: `e2e-test-pass`

Run the dashboard from the repo root:

```bash
pnpm dev:web
```

Then open `http://localhost:5173`.

## First-Run Troubleshooting

| Symptom | Check |
| --- | --- |
| Docker demo fails early | Run `pnpm demo:preflight` and fix the first failed check. |
| Colima memory is too low | Use `colima stop && colima start --memory 7 --cpu 4`. |
| Dashboard is empty | Run `pnpm run seed` for Track A or wait for demo traffic in Track B. |
| Browser telemetry is blocked | Run `obs-unified doctor <collector-url> --origin <app-origin>`. |
| AI Calls are empty | Set an LLM provider key and trigger an AI demo or instrument an LLM call. |
| Replays are empty | Open the app in a browser and trigger a replay-producing interaction. |

## Next

- Browse all examples: [`docs/examples.md`](./examples.md)
- Learn package installation: [`docs/github-packages.md`](./github-packages.md)
- Compare migration paths: [`docs/migrate/README.md`](./migrate/README.md)
