# Production Operations Guide

This guide provides operational runbooks, system requirements, and orchestration configurations for executing a high-availability, secure, and production-grade deployment of the `obs-unified` stack.

---

## 1. Network & Reverse Proxy Architecture

The recommended production layout isolates the telemetry collector behind an Nginx or Caddy reverse proxy serving over TLS. 

* **Collector Port**: `:8790` (ingests HTTP `/v1/*` OTLP payloads and proxies internal query services).
* **Dashboard Port**: `:5173` (static file serving or proxied SPA assets).

### Nginx Server Block Setup

Deploy Nginx on your gateway node and configure the reverse-proxy to protect the dashboard endpoints while keeping OTLP pipelines completely open:

```nginx
# /etc/nginx/sites-available/obs.my-app.com
server {
    listen 443 ssl http2;
    server_name obs.my-app.com;

    ssl_certificate /etc/letsencrypt/live/obs.my-app.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/obs.my-app.com/privkey.pem;

    # Gzip configurations for fast JSON/protobuf decompression
    gzip on;
    gzip_types application/json application/x-protobuf text/plain text/css;

    # Telemetry Ingestion (Publicly accessible OTLP routes)
    location /v1/ {
        proxy_pass http://127.0.0.1:8790;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Max OTLP request body size (spans / logs bundle)
        client_max_body_size 10m;
    }

    # Internal Dashboard Query Endpoints
    location /internal/ {
        proxy_pass http://127.0.0.1:8790;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Dashboard Static Files & Routing SPA
    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Enable SPA Hash Router fallback
        try_files $uri $uri/ /index.html;
    }
}
```

> Set `TRUST_PROXY=true` on the collector (and only when it is reachable solely through this proxy). Without it the dashboard login rate limit and client-IP handling key on the proxy's address instead of the real client, so one noisy client can lock everyone out of login.

CORS: the all-in-one image allows `localhost` and `127.0.0.1` on ports 5173, 5174, and 3000 by default. The standalone Node collector has no default; set `ALLOWED_ORIGINS` (comma-separated) to your dashboard and app origins, for example `https://obs.my-app.com`.

### Caddyfile Setup (Alternative)

For Caddy with automatic Let’s Encrypt TLS:

```caddy
obs.my-app.com {
    # Public Telemetry Ingest
    reverse_proxy /v1/* 127.0.0.1:8790 {
        header_up Host {host}
        header_up X-Real-IP {remote}
    }

    # Internal Query APIs
    reverse_proxy /internal/* 127.0.0.1:8790 {
        header_up Host {host}
        header_up X-Real-IP {remote}
    }

    # SPA Web Dashboard
    reverse_proxy /* 127.0.0.1:5173 {
        header_up Host {host}
        header_up X-Real-IP {remote}
    }
}
```

> Set `TRUST_PROXY=true` on the collector (and only when it is reachable solely through this proxy). Without it the dashboard login rate limit and client-IP handling key on the proxy's address instead of the real client, so one noisy client can lock everyone out of login.

---

## 2. PostgreSQL Connection Tuning

The standalone Node collector writes structured spans, logs, and events concurrently into your target Postgres instance. Tune your connection boundaries based on the anticipated workload.

### Connection Limits (`PG_POOL_MAX`)
Each collector instance uses a persistent client-side pool to manage database connections.
* **Default Value**: `10`
* **Production Tuning**: 
  * Under low to moderate traffic (1–50 spans/second), the default pool size is sufficient.
  * For high-throughput environments (>500 spans/second), scale the pool limit to `30` or `50` by configuring `PG_POOL_MAX=50`.
  * Ensure the sum of `PG_POOL_MAX` across all scaled collector instances does not exceed the `max_connections` limit set inside your `postgresql.conf` configuration file.

### Statement Timeout Tuning
To prevent bloated, unoptimized telemetry queries from locking the database, enforce an explicit statement timeout boundary:
* Configure statement timeouts inside your collector environment to terminate queries exceeding 30 seconds:
  ```bash
  PG_STATEMENT_TIMEOUT=30000
  ```

---

## 3. Storage Retention & Object Expirations (AWS S3 / MinIO)

`obs-unified` persists replay sessions (`.json` files) and system profiles (`.pprof` buffers) in your target S3 bucket. Telemetry is intended to serve as hot, active debugging context rather than cold historical archives.

Enforce a **72-hour automated deletion lifecycle** on your AWS S3 bucket to control operational costs and ensure database retention bounds (`RETENTION_HOURS=72`) map perfectly to your physical object storage layer.

### AWS CLI Lifecycle Configuration

Save the following rule profile as `lifecycle-policy.json`:

```json
{
  "Rules": [
    {
      "ID": "AutoDeleteOldTelemetryBlobs",
      "Status": "Enabled",
      "Filter": {
        "Prefix": ""
      },
      "Expiration": {
        "Days": 3
      }
    }
  ]
}
```

Apply this lifecycle rule directly to your S3 telemetry bucket using the AWS CLI tool:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket obs-unified-storage-bucket \
  --lifecycle-configuration file://lifecycle-policy.json
```

---

## 4. Kubernetes Orchestration Manifests

For scalable production container runtimes, execute `obs-unified` as a stateless horizontal deployment communicating with a managed PostgreSQL instance and cloud S3 bucket storage.

Every collector process ships an in-process scheduler for the three recurring jobs the Cloudflare Worker gets from Cron Triggers (due analyses every minute, alert evaluation every 5 minutes, retention cleanup hourly). It is **on by default**, so a plain multi-replica Deployment would run each job once per replica. The manifests below keep exactly one owner: serving replicas set `MAINTENANCE_ENABLED: "false"` via the shared ConfigMap, and a separate single-replica `obs-maintenance` Deployment re-enables it. See the [collector-node README](../../apps/collector-node/README.md#background-maintenance) for the `MAINTENANCE_*` settings.

### 1. ConfigMap and Secrets (`obs-config.yaml`)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: obs-config
  namespace: observability
data:
  BLOB_STORE: "s3"
  S3_REGION: "us-east-1"
  S3_BUCKET: "my-production-obs-bucket"
  PG_POOL_MAX: "30"
  PORT: "8790"
  RETENTION_HOURS: "72"
  # Serving replicas must not run background maintenance; the dedicated
  # obs-maintenance Deployment below overrides this to "true".
  MAINTENANCE_ENABLED: "false"
  # Behind the reverse proxy above: login rate limit and client IP use X-Forwarded-For.
  TRUST_PROXY: "true"
---
apiVersion: v1
kind: Secret
metadata:
  name: obs-secrets
  namespace: observability
type: Opaque
data:
  # Base64 encoded connection strings, AWS keys, and passwords
  DATABASE_URL: cG9zdGdyZXM6Ly91c2VyOnBhc3NAcGctaG9zdDo1NDMyL29ic191bmlmaWVk  # postgres://user:pass@pg-host:5432/obs_unified
  S3_ACCESS_KEY_ID: QUtJQVhYWFhYWFhYWFhYWFhYWFg=                           # AKIAXXXXXXXXXXXXXXX
  S3_SECRET_ACCESS_KEY: c2VjcmV0LWtleS12YWx1ZS1nb2VzLWhlcmU=               # secret-key-value-goes-here
  INGEST_KEY: bXktc2VjdXJlLXdyaXRlLWtleQ==                                 # my-secure-write-key
  DASHBOARD_PASSWORD: bXktc3VwZXItc2VjdXJlLXBhc3N3b3Jk                    # my-super-secure-password
  # Programmatic read/admin bearer token for /internal/* (MCP server, CLI).
  # Generate a fresh random value per environment and base64-encode it:
  #   openssl rand -hex 32 | tr -d '\n' | base64
  DASHBOARD_TOKEN: <base64 of your generated token>
```

`DASHBOARD_TOKEN` is the one secret shared with programmatic clients, so keep it distinct from `DASHBOARD_PASSWORD` and `INGEST_KEY`:

- The MCP server (`@obsunified/mcp-server`) sends `OBS_DASHBOARD_TOKEN` as `Authorization: Bearer`; it must equal this `DASHBOARD_TOKEN` exactly.
- The CLI (`@obsunified/cli`) sends `OBS_ADMIN_TOKEN` the same way for `keys mint`, `keys list`, and `doctor`; it must also equal this `DASHBOARD_TOKEN`.
- Rotate all three together. The collector compares the token in constant time and only on `/internal/*` and `GET /auth/check`; ingest keys never grant read access, and the token plays no part in ingest or background maintenance.

Both Deployments below mount the same `obs-secrets`, so the serving replicas and the single `obs-maintenance` replica accept the same token. See [Identity & External Access Recipes](./identity-access-recipes.md) for the full header-forwarding and proxy patterns.

### 2. Serving Collector Deployment (`obs-deployment.yaml`)

Handles ingest and dashboard traffic only. `MAINTENANCE_ENABLED` is inherited as `"false"` from the ConfigMap, so scaling `replicas` up or down never changes how many times a job runs.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: obs-collector
  namespace: observability
  labels:
    app: obs-collector
spec:
  replicas: 2
  selector:
    matchLabels:
      app: obs-collector
  template:
    metadata:
      labels:
        app: obs-collector
    spec:
      containers:
      - name: collector
        image: ghcr.io/dev-sawan-ruparel/obs-unified:2.2.2  # pin a tested version; avoid :latest
        ports:
        - containerPort: 8790
        envFrom:
        - configMapRef:
            name: obs-config
        - secretRef:
            name: obs-secrets
        resources:
          limits:
            cpu: "1"
            memory: 1Gi
          requests:
            cpu: "250m"
            memory: 512Mi
        readinessProbe:
          httpGet:
            path: /health
            port: 8790
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /health
            port: 8790
          initialDelaySeconds: 15
          periodSeconds: 20
---
apiVersion: v1
kind: Service
metadata:
  name: obs-collector-service
  namespace: observability
spec:
  selector:
    app: obs-collector
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8790
  type: ClusterIP
```

### 3. Maintenance Deployment (`obs-maintenance.yaml`)

The single owner of the scheduled jobs. Same image, ConfigMap, and Secret as the serving Deployment; the only differences are `replicas: 1`, the explicit `MAINTENANCE_ENABLED: "true"` override (a container `env` entry takes precedence over `envFrom`), a `Recreate` strategy so a rollout never has two maintenance pods alive at once, and a distinct `app` label so `obs-collector-service` never routes traffic to it.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: obs-maintenance
  namespace: observability
  labels:
    app: obs-maintenance
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: obs-maintenance
  template:
    metadata:
      labels:
        app: obs-maintenance
    spec:
      terminationGracePeriodSeconds: 30
      containers:
      - name: maintenance
        image: ghcr.io/dev-sawan-ruparel/obs-unified:2.2.2  # pin a tested version; avoid :latest
        ports:
        - containerPort: 8790
        envFrom:
        - configMapRef:
            name: obs-config
        - secretRef:
            name: obs-secrets
        env:
        - name: MAINTENANCE_ENABLED
          value: "true"
        resources:
          limits:
            cpu: "1"
            memory: 1Gi
          requests:
            cpu: "250m"
            memory: 512Mi
        readinessProbe:
          httpGet:
            path: /health
            port: 8790
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /health
            port: 8790
          initialDelaySeconds: 15
          periodSeconds: 20
```

Verify the split after applying both manifests:

```bash
kubectl -n observability logs deploy/obs-maintenance | grep '\[maintenance\] scheduler started'
kubectl -n observability logs deploy/obs-collector   | grep 'maintenance scheduler disabled'
```

On `SIGTERM` the maintenance pod stops arming new ticks, waits up to 10 s for an in-flight job, then closes its Postgres pool, which fits inside the 30 s grace period above. The serving Deployment's `/health` endpoint is unaffected by the scheduler, so the probes are identical.

**Never run two or more replicas of the same image without `MAINTENANCE_ENABLED=false` on all but one of them.** The all-in-one image and the Node collector default to `MAINTENANCE_ENABLED=true`, so every replica would otherwise run each scheduled job.

If you prefer a scheduler you already operate, set `MAINTENANCE_ENABLED: "false"` everywhere, omit `obs-maintenance`, and run the jobs from your own cron; do **not** leave the default (`true`) on a multi-replica serving Deployment.

---

## 5. Standard Upgrades & Database Migrations

During software updates, execute database migrations *before* recycling rolling container deployments to prevent schema mismatch errors inside the collector instances.

Pin the image to the version you are rolling out (`:2.2.2` here; use your target release) rather than `:latest`. Run the migrations securely on your database using a temporary migrations job container:

```bash
docker run --rm \
  -e DATABASE_URL="postgres://user:pass@pg-host:5432/obs_unified" \
  ghcr.io/dev-sawan-ruparel/obs-unified:2.2.2 \
  node /repo/apps/collector-node/scripts/migrate-pg.mjs
```

---

## 6. Backup and Restore

Applies to the all-in-one image, which keeps Postgres 15 (cluster `15/main`, database `obs_unified`, role `obs`) in `/var/lib/postgresql` and file blobs in `/data/blobs`. Managed Postgres plus S3 deployments should use the provider's snapshot and bucket-versioning tools instead.

**Back up** (container named `obs`; the embedded Postgres only accepts password auth over TCP, so pass `-h 127.0.0.1`):

```bash
docker exec -e PGPASSWORD=obs obs \
  pg_dump -h 127.0.0.1 -U obs --clean --if-exists obs_unified > backup.sql

docker run --rm -v obs-unified-blobs:/data -v "$PWD":/backup alpine \
  tar czf /backup/blobs.tgz -C /data .
```

`--clean --if-exists` makes the dump replace the schema the new container creates on first boot. `/data` only holds replay recordings and pprof profiles; skip the tarball if you do not need them.

**Restore** into empty volumes (a new container on fresh volumes, same image tag or newer):

```bash
# 1. Restore blobs into the empty blob volume before the first start
docker run --rm -v obs-unified-blobs:/data -v "$PWD":/backup alpine \
  tar xzf /backup/blobs.tgz -C /data

# 2. Start the container once so Postgres initializes and migrations run
docker run -d --name obs -p 5173:5173 -p 8790:8790 \
  -e INGEST_KEY -e DASHBOARD_PASSWORD -e DASHBOARD_TOKEN \
  -v obs-unified-db:/var/lib/postgresql -v obs-unified-blobs:/data \
  ghcr.io/dev-sawan-ruparel/obs-unified:<version>

# 3. Load the dump, then restart so the collector drops cached state
docker exec -i -e PGPASSWORD=obs obs psql -q -h 127.0.0.1 -U obs obs_unified < backup.sql
docker restart obs
```

Ingest keys live in the database, so they come back with the dump (a key you revoked stays revoked). `INGEST_KEY`, `DASHBOARD_PASSWORD`, and `DASHBOARD_TOKEN` come from the new container's environment; changing `DASHBOARD_PASSWORD` invalidates existing browser sessions.

## 7. Alerts and Webhooks

Alert rules are evaluated by the maintenance scheduler every 5 minutes (see the maintenance split in the Kubernetes section). Webhook channels are admin-supplied URLs that the collector POSTs to from inside its own network, so they are validated:

* Only plain `http(s)` URLs to **public** hosts are accepted. Loopback, RFC 1918 ranges, link-local (cloud metadata) addresses, and embedded credentials are rejected. Hostnames are checked as written, so a name that resolves to a private address is not caught at validation time.
* To post to an internal receiver (for example an in-cluster Alertmanager or a local webhook sink), set `ALERT_WEBHOOK_ALLOW_PRIVATE=true` on the collector. The Workers collector honours it today; the Node/Docker image requires image 2.2.2 or newer, which forwards the flag (earlier Node images ignored it even though the rejection message mentions it).
* Webhook URLs are redacted in logs and span attributes (only the origin and first path segment are kept), since Slack and PagerDuty style hooks carry secrets in the path.
* The seeded sample data (`OBS_LOCAL_SEED=true`) includes a placeholder `hooks.example.com` webhook that cannot deliver. Replace it with a real endpoint or disable the channel before relying on alert delivery.

## 8. Monitoring the Collector

* **Health**: `GET /health` is the only probe endpoint. There is no `/metrics` and no `/ready` route, so use `/health` for both readiness and liveness (as in the manifests above).
* **Docker**: the image ships a `HEALTHCHECK` (every 15s) that needs both the collector `/health` on `:8790` and the dashboard on `:5173` to answer. `docker ps` shows `healthy` or `unhealthy`.
* **Logs**: written to stdout/stderr as `[component] message` followed by an optional fields object, for example `[maintenance] scheduler started { ... }`. Startup lines use the `[obs-unified]` prefix. Fields are printed with Node's console, so treat them as readable key/value output rather than strict JSON when building log parsers.

---

## 9. Identity & External Access Layer

`obs-unified` does not contain native per-user RBAC or SSO. To deploy behind Cloudflare Access or `oauth2-proxy` with proper path boundaries, secrets management, header forwarding, and MCP service tokens, see the dedicated [Identity & External Access Recipes](./identity-access-recipes.md).
