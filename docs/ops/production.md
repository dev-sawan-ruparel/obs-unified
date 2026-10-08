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
```

### 2. Collector Deployment (`obs-deployment.yaml`)

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
        image: obs-unified/collector:latest
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

---

## 5. Standard Upgrades & Database Migrations

During software updates, execute database migrations *before* recycling rolling container deployments to prevent schema mismatch errors inside the collector instances.

Run the migrations securely on your database using a temporary migrations job container:

```bash
docker run --rm \
  -e DATABASE_URL="postgres://user:pass@pg-host:5432/obs_unified" \
  obs-unified/collector:latest \
  node /repo/apps/collector-node/scripts/migrate-pg.mjs
```
