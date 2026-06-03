# measure-ingest

A throwaway load harness for the collector's trace ingest + read paths. It
answers two questions from the ingest-scaling work:

- **Q1 — latency.** How long do `/v1/traces` ingest, trace-detail reads, and the
  **read-time gap computation** (`/internal/telemetry/traces/:id/gaps`) take
  end-to-end against a real local D1?
- **Q3 — read/write counting.** Does the read-rate instrumentation
  (`query.trace_detail` / `query.trace_gaps` spans, `traces.trace_count`
  attribute) account correctly? (The *ratio* it prints is whatever you
  configure — it validates the mechanics, not the production rate.)

## Run

```bash
pnpm measure:ingest
# or: bash scripts/measure-ingest/run.sh
```

`run.sh` applies all migrations to an **isolated** local D1 state dir, starts
`wrangler dev` on `:18792` with `ALLOW_UNAUTHENTICATED=true`, drives traffic via
`traffic.mjs`, and tears the collector down on exit. The port and state dir are
offset from `dev:collector` (8790) and `e2e:otlp` (18790), so a collector you
already have running is left untouched.

### Tunables (env vars)

| Var              | Default                     | Meaning                          |
| ---------------- | --------------------------- | -------------------------------- |
| `INGEST`         | `1000`                      | traces to ingest                 |
| `READS`          | `100`                       | traces to read back              |
| `SPANS`          | `20`                        | spans per trace                  |
| `COLLECTOR_PORT` | `18792`                     | dev collector port               |
| `STATE_DIR`      | `/tmp/obs-measure-ingest`   | isolated D1 state + logs          |
| `BASE`           | `http://localhost:18792`    | target URL (`traffic.mjs` direct) |

Run `traffic.mjs` standalone against an already-running collector:

```bash
BASE=http://localhost:8790 INGEST=2000 READS=200 node scripts/measure-ingest/traffic.mjs
```

## Output

JSON with `mean/p50/p95/p99/max` (ms) for ingest, trace-detail read, and gaps
read, plus blindspot totals and the configured read/write ratio.

## Caveats

- **Local Miniflare D1**, not production D1/Postgres — absolute numbers will
  differ. The useful, portable conclusion is *relative*: read-time gap compute
  is negligible next to the DB round-trip (the gaps read ≈ a plain trace-detail
  read), which is why gaps are computed lazily (see PRs #21, #23, #25).
- The printed read/write ratio is **driven**, not observed. The real
  "fraction of traces ever viewed" must come from a self-instrumented
  deployment: `count(query.trace_detail) / sum(traces.ingest → traces.trace_count)`
  over a window, queried from the collector's own `obs-dashboard` telemetry.
