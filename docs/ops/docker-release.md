# Docker Release Guide (GHCR)

This guide documents the manual build, local validation, and release workflow for the official `obs-unified` prebuilt Docker image:
`ghcr.io/dev-sawan-ruparel/obs-unified`.

> [!NOTE]
> Prebuilt images on GitHub Container Registry (GHCR) are published through manual, local releases. GitHub Actions and runner workflows are not used. No prebuilt image is claimed to exist in GHCR until the manual publishing steps below have been executed.

---

## 1. Image Architecture & Deployment Scope

The distributed container is an all-in-one image packaging the Node collector runtime, React dashboard SPA, and embedded PostgreSQL database with filesystem blob storage.

> [!WARNING]
> **Evaluation & Small Self-Host Scope Only**
> This all-in-one image is designed for evaluation, demos, local sandboxes, and small self-hosted setups. It is **not** hardened for multi-tenant or enterprise production:
> - The embedded PostgreSQL service runs on container localhost with fixed internal database credentials (`obs:obs`).
> - PostgreSQL database and Node collector processes share the same container lifecycle.
>
> **For production deployments**, do not use this all-in-one image. Use the standalone Node collector ([`apps/collector-node`](../../apps/collector-node/README.md)) connected to a dedicated external PostgreSQL instance and S3-compatible blob bucket (AWS S3, MinIO, or Cloudflare R2), configured behind a reverse proxy as detailed in the [Production Operations Guide](production.md).

### Ports

| Port | Protocol | Purpose |
| :--- | :--- | :--- |
| `8790` | TCP | Collector ingestion (`/v1/*` OTLP traces, logs, replays, metrics, AI calls), internal query APIs (`/internal/*`), and `/health`. |
| `5173` | TCP | Web dashboard UI SPA and local reverse proxy for `/auth`, `/internal`, and `/v1`. |

### Storage & Volumes

| Path | Description | Recommended Volume Mount |
| :--- | :--- | :--- |
| `/var/lib/postgresql` | PostgreSQL database files (`$PGDATA`, cluster `15/main`). Stores relational entities, migrations, and index metadata. | `-v obs-unified-db:/var/lib/postgresql` |
| `/data` | File blob storage (`/data/blobs`). Stores replay recordings and pprof CPU/memory profiles. | `-v obs-unified-blobs:/data` |

### Environment Variables

| Variable | Default (Release Image) | Purpose / Security Requirement |
| :--- | :--- | :--- |
| `REQUIRE_AUTH_CONFIG` | `true` | Fails closed on startup if `INGEST_KEY` or `DASHBOARD_PASSWORD` are missing or set to default dummy values. |
| `INGEST_KEY` | *(None - Required)* | Secret key required for SDK/OTel client telemetry ingestion. Masked in startup logs. |
| `DASHBOARD_PASSWORD` | *(None - Required)* | Admin password required for authenticating to the web dashboard. Masked in startup logs. |
| `OBS_LOCAL_SEED` | `false` | Disabled by default in the release image. Set to `true` only if seeding synthetic sample data is explicitly desired. |
| `PORT` | `8790` | Collector listen port. |
| `OBS_DASHBOARD_PORT` | `5173` | Dashboard listen port. |
| `ALLOWED_ORIGINS` | `localhost` and `127.0.0.1` on ports `5173`, `5174`, and `3000` | Comma-separated CORS allowed origins (set explicitly for any other origin). |
| `ALERT_WEBHOOK_ALLOW_PRIVATE` | *(unset)* | Set `true` to allow alert webhooks to target private or loopback addresses (refused by default). |
| `DATABASE_URL` | `postgres://obs:obs@127.0.0.1:5432/obs_unified` | Connection string for internal PostgreSQL. |
| `BLOB_STORE` | `file` | Blob storage backend (`file` or `s3`). |
| `BLOB_DIR` | `/data/blobs` | Filesystem blob path when `BLOB_STORE=file`. |

> [!IMPORTANT]
> The release image enforces fail-closed authentication: if started without setting explicit, non-default values for `INGEST_KEY` and `DASHBOARD_PASSWORD`, the container terminates immediately with an error. Credential printing is suppressed in startup logs. For zero-config local playground development, use `Dockerfile.local` (`pnpm local:image && pnpm local:run`).

---

## 2. Local Build

Build the reproducible release image locally using the release script:

```bash
# Build using version from package metadata and current Git SHA
pnpm docker:build

# Or specify an explicit release version and Git commit SHA:
bash scripts/release-docker/build.sh 2.0.1 --sha e4ea903
```

The build script:
- Builds the root multi-stage `Dockerfile`.
- Applies standard OCI metadata labels (`org.opencontainers.image.*`).
- Tags the image:
  - `ghcr.io/dev-sawan-ruparel/obs-unified:<version>` (e.g. `2.0.1`)
  - `ghcr.io/dev-sawan-ruparel/obs-unified:sha-<sha>` (immutable commit reference)
  - `ghcr.io/dev-sawan-ruparel/obs-unified:latest` (optional; omit with `--no-latest`)

---

## 3. Local Smoke Validation

Before publishing, execute the automated release smoke test:

```bash
# Validate the built image
pnpm docker:smoke

# Or test a specific tag:
bash scripts/release-docker/smoke.sh ghcr.io/dev-sawan-ruparel/obs-unified:2.0.1
```

The smoke test verifies:
1. **Fail-closed security**: Confirms the container refuses to run without required credentials.
2. **Container startup**: Boots container with non-conflicting test ports.
3. **Collector health**: Verifies `GET /health` returns HTTP 200.
4. **Dashboard SPA**: Verifies `GET /` serves HTML containing `<title>obs-unified</title>`.
5. **Dashboard authentication**: Verifies `POST /auth/login` successfully authenticates with the provided password.
6. **OTLP ingest pipeline**: Submits an OTLP trace JSON payload to `POST /v1/traces` and confirms HTTP 200 ingestion.
7. **Clean teardown**: Gracefully shuts down and removes test containers.

---

## 4. Manual Publish Workflow

When local build and smoke tests pass, follow these steps to publish to GitHub Container Registry:

### Step 1: Authenticate to GHCR
Authenticate Docker to GHCR using your existing GitHub CLI session or standard docker login (never store personal access tokens in workspace files):

```bash
gh auth token | docker login ghcr.io -u <github-username> --password-stdin
```

### Step 2: Push Image Tags
Push the validated release tags:

```bash
# Push version and SHA tags
docker push ghcr.io/dev-sawan-ruparel/obs-unified:2.0.1
docker push ghcr.io/dev-sawan-ruparel/obs-unified:sha-e4ea903

# Push latest tag if this is the newest release
docker push ghcr.io/dev-sawan-ruparel/obs-unified:latest
```

### Step 3: Configure Package Visibility
On first publish:
1. Navigate to **GitHub Profile / Organization → Packages → obs-unified**.
2. Go to **Package settings → Danger Zone → Change package visibility**.
3. Set visibility to **Public** to enable anonymous pulls.

### Step 4: Verify Anonymous Pull
In an unauthenticated terminal or test environment:

```bash
docker pull ghcr.io/dev-sawan-ruparel/obs-unified:2.0.1
```

---

## 5. Running & Rollback

### Running the Prebuilt Image (Evaluation / Small Self-Host)

Inject runtime credentials from your external environment or an uncommitted `.env` file; avoid passing literal secret values in commands or storing secrets in the repository:

```bash
# Option A: Passing variables from the host environment
export INGEST_KEY="<illustrative-random-ingest-key>"
export DASHBOARD_PASSWORD="<illustrative-random-dashboard-password>"

docker run -d \
  --name obs-unified \
  -p 5173:5173 \
  -p 8790:8790 \
  -e INGEST_KEY \
  -e DASHBOARD_PASSWORD \
  -v obs-unified-db:/var/lib/postgresql \
  -v obs-unified-blobs:/data \
  --restart unless-stopped \
  ghcr.io/dev-sawan-ruparel/obs-unified:2.0.1

# Option B: Injecting from an external env file
# docker run -d --name obs-unified -p 5173:5173 -p 8790:8790 --env-file /path/to/secure.env -v obs-unified-db:/var/lib/postgresql -v obs-unified-blobs:/data ghcr.io/dev-sawan-ruparel/obs-unified:2.0.1
```

### Rollback Procedure

1. **Deployments**: Never rely on mutable `:latest` in non-ephemeral setups. Always pin to an immutable tag (`:<version>` or `:sha-<sha>`). To roll back, update your container run or compose definition to point to the previous version tag (e.g. `:2.0.0`).
2. **Reverting the `latest` tag**: If a faulty release was pushed to `:latest`, retag the previous known-good image and re-push:
   ```bash
   docker tag ghcr.io/dev-sawan-ruparel/obs-unified:sha-<good-sha> ghcr.io/dev-sawan-ruparel/obs-unified:latest
   docker push ghcr.io/dev-sawan-ruparel/obs-unified:latest
   ```
3. **Deprecating a broken release**: If a version tag contains a critical defect, mark the release as broken in GitHub Packages settings or delete the specific tag via GitHub Container Registry package settings.
