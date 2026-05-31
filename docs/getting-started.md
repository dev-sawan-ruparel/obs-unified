# Getting Started

This guide provides the necessary procedures to bootstrap the obs-unified platform from a fresh repository checkout to seeing active telemetry in the dashboard.

## Setup Options

Select the bootstrap method that matches your target environment and evaluation goals:

| Method | Target Environment & Capabilities |
| :--- | :--- |
| **[Track 0 — Standalone Docker Image](#track-0--one-local-docker-image)** | A zero-dependency local setup running all services (Postgres, Collector, Dashboard, and file-system storage) inside a single container. Includes pre-seeded sample data. |
| **[Track A — Local Repository + Synthetic Data](#track-a--local-repo--synthetic-data)** | Running services natively on the host system using Node.js and Postgres, then populating dashboards via a synthetic seeder. |
| **[Track B — Astronomy Shop Demo](#track-b--astronomy-shop-demo)** | Running a multi-container microservice suite instrumented with OpenTelemetry to generate realistic multi-service spans, metrics, and service maps. |
| **[Track C — Direct SDK Integration](#track-c--instrument-your-app)** | Connecting your own host applications directly to an obs-unified collector using the platform's client-side and server-side SDKs. |

## Prerequisites

* **Docker**: Required for Track 0, Track B, or the standalone Node collector setup.
* **Node.js 22+ & pnpm 10+**: Required for all host-native development paths (Track A).

---

## Track 0 — One Local Docker Image

This method packages the entire stack—including PostgreSQL, the Collector API, the Dashboard UI, local filesystem blob storage, and seeded mock data—into a single container. It is the lowest-friction pathway for initial UI and feature evaluation. For a component-level map of what this container runs, see [`docs/system-components.md`](./system-components.md).

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
To persist local database and blob storage states across container restarts, create and mount Docker volumes:
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
Run the local image smoke test to build the image, boot a fresh container, seed data, and verify collector health, dashboard HTML, and login from outside Docker:
```bash
pnpm smoke:local-image
```

---

## Track A — Local Repo + Synthetic Data

This method runs the development servers directly on your host machine. This is the optimal track for modifying dashboard code or iterating on the collector locally without container layers.

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

Start the development servers (Collector on `:8790`, Demo API on `:8787`, and Web Dashboard on `:5173`):
```bash
pnpm run dev
```

### 2. Seed Simulated Data
In a secondary terminal window, execute the synthetic seeder to populate active tables:
```bash
pnpm run seed
```

### 3. Access URLs
* **Dashboard:** `http://localhost:5173`
* **Demo API:** `http://localhost:8787`
* **Collector:** `http://localhost:8790`

**Evaluation note:** Browsing Traces, Logs, AI Calls, Usage, and Issues displays immediate synthetic data. To preview **Replays**, navigate to the dashboard's *Playground* tab and click the simulated replay trigger.

---

## Track B — Astronomy Shop Demo

This track runs the official OpenTelemetry Astronomy Shop demo (~15 microservices written in Go, Java, .NET, Node, Python, and Rust) and points its native OTel exporters directly at your local obs-unified collector.

### 1. Setup and Preflight Check
Clone and prepare the upstream demo services:
```bash
pnpm demo:setup
```

Run preflight configuration diagnostics to ensure port availability and engine support:
```bash
pnpm demo:preflight
```

Launch the host collector to receive the incoming streams:
```bash
pnpm dev:collector
```

### 2. Launch the Microservices
In a secondary terminal, spin up the demo compose stack:
```bash
pnpm demo:up
```

### 3. Access URLs
* **Dashboard:** `http://localhost:5173`
* **Shop Web Interface:** `http://localhost:8080`

**Verification:** The load generator requires approximately 30 seconds to begin driving traffic. Once running, Traces, Service Maps, Issues, Logs, and Metrics populate dynamically from active microservice calls.

### 4. Cleanup
To stop and remove the container stack:
```bash
pnpm demo:down
```

---

## Track C — Instrument Your App

This track guides you through adding obs-unified instrumentation directly to your own application codebase.

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
The core pipeline configuration is standard across all paths:
1. Deploy or run an accessible collector endpoint.
2. Install the appropriate client or server SDK package.
3. Configure the `OBS_COLLECTOR_URL` environment variable and specify a write-only ingest key.
4. Ensure your API CORS policies allow the custom propagation header: `x-obs-interaction`.
5. Run the validation tool to verify connectivity:
   ```bash
   obs-unified doctor http://localhost:8790 --origin http://localhost:5173
   ```

---

## Standalone Node Collector

For host or container environments requiring a dedicated telemetry ingestion node backed by Postgres and MinIO/S3, run the standalone server:

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
| **Dashboard displays empty state** | For Track A, confirm `pnpm run seed` was run. For Track B, allow up to 30 seconds for traffic to establish. |
| **Browser telemetry requests are blocked** | Verify CORS rules using: `obs-unified doctor <collector-url> --origin <app-origin>`. |
| **AI Calls table is empty** | Verify the LLM provider key is defined in your active environment variables and trigger an AI span. |
| **Replays table is empty** | Load the target application in the browser and perform a recording-eligible user action. |

---

## Next Steps

* **Browse Examples:** [`docs/examples.md`](./examples.md)
* **Configure Package Registry:** [`docs/github-packages.md`](./github-packages.md)
* **Plan Database Migrations:** [`docs/migrate/README.md`](./migrate/README.md)
