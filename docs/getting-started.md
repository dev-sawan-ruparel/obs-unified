# Getting Started

This guide gets you from a fresh checkout to active telemetry in the dashboard.
There are two decisions:

1. **How do you want to run obs-unified?** Use the all-in-one Docker image, or
   install and run the repo locally.
2. **What data do you want to look at?** Use seeded sample data, the Astronomy
   Shop demo, or telemetry from your own app.

## Choose How To Run

Pick one runtime path first. You can use any data option after a collector and
dashboard are running.

| Runtime path | Use when | Starts |
| :--- | :--- | :--- |
| **[Option 1 — Docker image](#option-1--docker-image)** | You want the quickest first run with the fewest host dependencies. | Postgres, collector, dashboard, filesystem blob store, and sample data in one container. |
| **[Option 2 — local install](#option-2--local-install)** | You want to edit code, run dev servers, or inspect internals while using the repo. | Local collector, demo API, and Vite dashboard from the workspace. |

## Choose What To Observe

After the stack is running, choose one or more data paths:

| Data path | Use when | Start here |
| :--- | :--- | :--- |
| **[Seeded sample data](#seeded-sample-data)** | You want populated dashboards immediately. | Built into Option 1, or run `pnpm run seed` with Option 2. |
| **[Astronomy Shop demo](#astronomy-shop-demo)** | You want realistic microservice traffic and service-map edges. | Run the OpenTelemetry demo against your local collector. |
| **[Your own app](#your-own-app)** | You want to validate obs-unified against a real application. | Add SDKs or OpenTelemetry exporters pointing at your collector. |

## Prerequisites

* **Docker**: Required for the Docker image and Astronomy Shop demo.
* **Node.js 22+ & pnpm 10+**: Required for local install and repo scripts.

---

## Option 1 — Docker Image

This packages the full local stack into one container. It is the lowest-friction
first run. For a component-level map of what this container runs, see
[`docs/system-components.md`](./system-components.md).

### 1. Build and Launch

Build the image locally:

```bash
pnpm local:image
```

Start the container:

```bash
pnpm local:run
```

**Alternative (Direct Docker commands without pnpm):**
```bash
docker build -f Dockerfile.local -t obs-unified/local:dev .
docker run --rm -p 5173:5173 -p 8790:8790 obs-unified/local:dev
```

### 2. Access the Interfaces

* **Dashboard:** `http://localhost:5173`
* **Collector Ingest:** `http://localhost:8790`

**Access Credentials:**
* **Ingest Write Key:** `dev-ingest-key`
* **Dashboard Password:** `e2e-test-pass`

### 3. Persistent Storage (Optional)

To persist local database and blob storage state across container restarts,
create and mount Docker volumes:

```bash
docker volume create obs-unified-local-db
docker volume create obs-unified-local-blobs
docker run --rm \
  -p 5173:5173 \
  -p 8790:8790 \
  -v obs-unified-local-db:/var/lib/postgresql \
  -v obs-unified-local-blobs:/data \
  obs-unified/local:dev
```

### 4. Verify the First-Run Path

Run the local image smoke test to build the image, boot a fresh container, seed
data, and verify collector health, dashboard HTML, and login from outside
Docker:

```bash
pnpm smoke:local-image
```

---

## Option 2 — Local Install

This runs the development servers directly on your host machine. Use this when
you are modifying dashboard code, collector code, or SDK packages.

### 1. Repository Setup and Boot

Clone the repository and install workspace dependencies:

```bash
git clone https://github.com/obs-unified/obs-unified.git
cd obs-unified
pnpm install
```

Configure and initialize the databases:

```bash
pnpm run setup
```

Start the development servers:

```bash
pnpm run dev
```

* **Dashboard:** `http://localhost:5173`
* **Demo API:** `http://localhost:8787`
* **Collector:** `http://localhost:8790`

After the stack is running, choose a data path below.

---

## Seeded Sample Data

Use this when you want populated dashboards immediately.

* Docker image: sample data is seeded automatically on startup.
* Local install: run the seeder in a second terminal.

```bash
pnpm run seed
```

Expected result: Traces, Logs, AI Calls, Usage, and Issues should show sample
data. Replays require browser interaction, so open the dashboard's Playground
tab and trigger a replay-producing interaction once.

---

## Astronomy Shop Demo

Use this when you want realistic microservice traffic and service-map edges. It
runs the official OpenTelemetry Astronomy Shop demo and points its exporters at
your local obs-unified collector.

This path assumes the collector is already running. For local development, start
it with:

```bash
pnpm dev:collector
```

### 1. Setup and Preflight Check

Clone and prepare the upstream demo services:

```bash
pnpm demo:setup
```

Run preflight configuration diagnostics to ensure port availability and engine support:

```bash
pnpm demo:preflight
```

### 2. Launch the Microservices

In a secondary terminal, spin up the demo compose stack:

```bash
pnpm demo:up
```

### 3. Access URLs

* **Dashboard:** `http://localhost:5173`
* **Shop Web Interface:** `http://localhost:8080`

The load generator requires approximately 30 seconds to begin driving traffic.
Once running, Traces, Service Maps, Issues, Logs, and Metrics populate
dynamically from active microservice calls.

### 4. Cleanup

To stop and remove the container stack:

```bash
pnpm demo:down
```

---

## Your Own App

Use this when you want to validate obs-unified against a real application. This
is not a separate way to run obs-unified; it is a data path that sends telemetry
to whichever collector you started above.

### 1. Implementation Pathways

Select the guide matching your application framework:

| Target Framework / Platform | Setup Guide Location |
| :--- | :--- |
| **React/Vite Frontend + Hono API** | [`docs/howto/instrument-react-hono.md`](./howto/instrument-react-hono.md) |
| **Python Flask API** | [`docs/howto/instrument-python-flask.md`](./howto/instrument-python-flask.md) |
| **Browser-only Application** | [`packages/analytics-sdk/README.md`](../packages/analytics-sdk/README.md) |
| **TypeScript Backend** | [`packages/telemetry-sdk/README.md`](../packages/telemetry-sdk/README.md) |
| **Polyglot Recipes (Python, Go, Rust, JVM, .NET)** | [`docs/recipes/README.md`](./recipes/README.md) |
| **All Examples Directory** | [`docs/examples.md`](./examples.md) |

### 2. Common Integration Steps

The core pipeline configuration is standard across app types:

1. Deploy or run an accessible collector endpoint.
2. Install the appropriate client or server SDK package.
3. Configure the `OBS_COLLECTOR_URL` environment variable and specify a write-only ingest key.
4. Ensure your API CORS policies allow the custom propagation header: `x-obs-interaction`.
5. Run the validation tool to verify connectivity:

   ```bash
   obs-unified doctor http://localhost:8790 --origin http://localhost:5173
   ```

---

## Standalone Node Collector Variant

The all-in-one Docker image is the recommended first-run Docker path. If you
only want the collector service backed by Postgres and MinIO/S3, use the
standalone Node collector:

### 1. Launch Container

```bash
cd apps/collector-node
docker compose up -d
docker compose logs -f collector
```

* **Endpoint:** `http://localhost:8790`
* **Ingest Key:** `dev-ingest-key`
* **Password:** `e2e-test-pass`

### 2. Launch Dashboard

Run the dashboard server from the repository root:

```bash
pnpm dev:web
```
Access the interface at `http://localhost:5173`.

---

## First-Run Troubleshooting

| Symptom / Error | Diagnostic Action |
| :--- | :--- |
| **Docker compose demo fails to launch** | Execute `pnpm demo:preflight` and address the first reported system check failure. |
| **Colima / VM memory resource depletion** | Expand hardware allocation: `colima stop && colima start --memory 7 --cpu 4`. |
| **Dashboard displays empty state** | Run `pnpm run seed`, wait for Astronomy Shop traffic, or confirm your own app is sending telemetry. |
| **Browser telemetry requests are blocked** | Verify CORS rules using: `obs-unified doctor <collector-url> --origin <app-origin>`. |
| **AI Calls table is empty** | Verify the LLM provider key is defined in your active environment variables and trigger an AI span. |
| **Replays table is empty** | Load the target application in the browser and perform a recording-eligible user action. |

---

## Next Steps

* **Browse Examples:** [`docs/examples.md`](./examples.md)
* **Configure Package Registry:** [`docs/github-packages.md`](./github-packages.md)
* **Plan Database Migrations:** [`docs/migrate/README.md`](./migrate/README.md)
