# RFC 0008: Storage interface refactor

- **Status:** Draft
- **Author:** @sawanruparel
- **Created:** 2026-05-02
- **Updated:** 2026-05-02
- **Parent:** [RFC 0003 — Unified Stack](0003-unified-stack.md)
- **Target:** `@obsunified/collector`

## Summary

Introduce a narrow `Store` interface per signal family (spans, logs, metrics,
replay, AI, profiles) and a shared `IdentityIndex` for cross-signal joins,
decoupling collector code from D1-specific calls. The motivation is _not_ to
migrate off SQLite — D1 remains the default and is sufficient for the indices
RFCs 0004 – 0007 propose. The motivation is to prevent new code (RFC 0007's
`profile_blobs`, RFC 0004's `interaction_id` indices) from entrenching D1
specifics, so that when a real deployment hits the SQLite ceiling, ClickHouse /
DuckDB / Postgres swap-in is a sprint, not a rewrite.

This is **scaffolding work**, not a feature. It pays no immediate user-visible
dividend. It pays a compounding internal dividend on every subsequent RFC.

## Motivation

Current state: most collector code reaches into `c.env.DB` (Cloudflare D1's
`D1Database`) directly. This is fine for one runtime; it's a problem for three
converging reasons:

1. **D1's row-store hits a wall on metric cardinality and profile sample
   storage.** RFC 0007 estimates ~700 MB/day of pprof blobs for a small fleet —
   fine in R2 but the metadata index plus future high-cardinality metrics can
   run out the practical ceiling around 100M hot rows.
2. **Future signals will not all fit D1.** Aggregate flame-graph queries (Phase
   2 of RFC 0007), kernel event firehoses (RFC 0009), and PromQL-style metric
   queries belong on a columnar engine.
3. **The README and the project's positioning advertise Node/Bun deployment**
   (the collector is described as "runs on Hono — Cloudflare Workers, Node.js,
   Deno, Bun"). Today the only shipped deployment is the Cloudflare Worker in
   `apps/collector` — there is no Node entry, no `better-sqlite3` dependency, no
   fs-backed SQLite path. The RFC seam exists so adding that path is a
   deliberate small piece of work (one adapter), not a
   fork-the-stores-and-rewrite-them rewrite.

The right move is the textbook one: define a thin storage interface, keep D1 as
the default implementation, refactor existing stores to use it, and force new
code through it.

## Today

### What exists

The `lib/` directory carries `*-store.ts` files for each signal family:

- [`store.ts`](../packages/obs-collector/src/lib/store.ts) — `TelemetryStore`:
  spans, service map, error rollups
- [`logs-store.ts`](../packages/obs-collector/src/lib/logs-store.ts)
- [`metrics-store.ts`](../packages/obs-collector/src/lib/metrics-store.ts)
- [`ai-store.ts`](../packages/obs-collector/src/lib/ai-store.ts)
- [`alerts-store.ts`](../packages/obs-collector/src/lib/alerts-store.ts)
- [`analyses-store.ts`](../packages/obs-collector/src/lib/analyses-store.ts)
- [`projects-store.ts`](../packages/obs-collector/src/lib/projects-store.ts)
- [`usage-store.ts`](../packages/obs-collector/src/lib/usage-store.ts)

(Other files in `lib/` like `analyses-runner.ts`, `narrate-gate.ts`, `ask.ts`
are not stores — they orchestrate over the stores above.)

Each store:

- Takes a `D1Database` in its constructor.
- Calls `db.prepare(...).bind(...).all() / .first() / .run()` directly.
- Embeds SQLite/D1 SQL syntax.

There is no shared interface, no abstraction over `prepare`, and no place to put
runtime-detection logic ("am I on D1 or better-sqlite3?"). Concrete count: **~45
call sites** in the collector reach `c.env.DB.prepare(...)` directly (across
plugins and stores). Any future engine swap touches every one of them today.

The framework already accepts injected dependencies —
[framework/collector.ts](../packages/obs-collector/src/framework/collector.ts)
`CollectorConfig` exposes `plugins`, `dashboardAuth`, `logger`, `withChildSpan`.
**It does not expose an `sqlDb` slot yet** — adding one is part of this RFC.

### Gaps

| Gap                                                                                 | Today                                                                                                     |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Common `Store` interface                                                            | absent                                                                                                    |
| Cross-signal `IdentityIndex` (the "given a session_id, what entities exist") helper | absent — each call site re-implements with raw SQL                                                        |
| Adapter for non-D1 SQLite (Node)                                                    | partial; `apps/collector` hand-binds better-sqlite3, but the call shape isn't identical                   |
| Adapter for ClickHouse / Postgres                                                   | absent                                                                                                    |
| Test seam (in-memory mock for unit tests)                                           | each test (e.g. [`stage6.test.ts`](../packages/obs-collector/src/lib/stage6.test.ts)) hand-rolls a FakeDb |

## Proposed design

### Layer 1: a thin DB adapter

Replace direct `c.env.DB.prepare(...).bind(...)` calls with a tiny adapter type:

```ts
export interface SqlDb {
  prepare(sql: string): SqlStatement;
}

export interface SqlStatement {
  bind(...args: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
```

This is **deliberately D1's existing shape**, because D1 is the only case we
ship today and we don't want to re-paper everything for a hypothetical future.
Implementations:

- `D1Adapter` — wraps `D1Database` (no-op pass-through). Lands in this RFC.
- `MemSqlDb` — in-memory test double. Lands in this RFC for the unit-test seam.
- `BetterSqliteAdapter` — wraps `better-sqlite3` to expose the same async-ish
  API. **Not built in this RFC.** Built when a Node deployment is actually
  attempted; the seam exists, but writing untested Node code for a runtime
  nothing uses is just speculative scope.
- `ClickHouseAdapter` — much later. Translates `prepare/bind` into HTTP calls to
  ClickHouse, with a SQL dialect translator for the ~5 SQLite-isms we use. Not
  built in this RFC.

Existing stores take `SqlDb` instead of `D1Database`. Migration:
search-and-replace the constructor type, no SQL changes.

### Layer 2: per-signal `Store` interfaces (lightweight)

For each signal family, define an interface listing the high-level operations
the collector / dashboard make against it. Concrete classes implement.

Example for traces:

```ts
export interface TraceStore {
  ingest(spans: StoredSpan[]): Promise<{ inserted: number; rejected: number }>;
  getTrace(projectId: string, traceId: string): Promise<TraceTree | null>;
  getServiceMap(projectId: string, hours: number): Promise<ServiceMap>;
  getRecentErrorSpans(
    projectId: string,
    opts: { limit: number },
  ): Promise<StoredSpan[]>;
}

export class D1TraceStore implements TraceStore {
  constructor(private db: SqlDb) {}
  // ...existing TelemetryStore methods, untouched SQL.
}
```

The interface lists _what the collector wants_, not _how SQLite stores it_. A
future ClickHouse implementation can have completely different SQL but the same
shape.

We do **not** abstract everything. Operations specific to a single store (e.g.
retention sweep, internal stats) stay on the concrete class.

### Layer 3: `IdentityIndex` for cross-signal joins

The most underused abstraction today. Currently, "given a session_id, what
entities exist?" is implemented separately in
[timeline-routes.ts](../packages/obs-collector/src/plugins/timeline-routes.ts)
and (with RFC 0006) will be re-implemented again in
`/internal/connected/:kind/:id`.

Centralize:

```ts
export interface IdentityIndex {
  bySession(projectId: string, sessionId: string): Promise<EntityManifest>;
  byTrace(projectId: string, traceId: string): Promise<EntityManifest>;
  byInteraction(
    projectId: string,
    interactionId: string,
  ): Promise<EntityManifest>;
  byUser(
    projectId: string,
    userId: string,
    opts: { limit: number },
  ): Promise<EntityManifest>;
}

export interface EntityManifest {
  spans: SpanRef[];
  logs: LogRef[];
  usageEvents: UsageEventRef[];
  aiCalls: AiCallRef[];
  replay: ReplayRef | null;
  profiles: ProfileBlobRef[]; // RFC 0007
  alerts: AlertRef[]; // alerts firing on this entity
}
```

Implementation: 6-8 small queries fanned out via `Promise.all`. Most live in
their respective `*Store` and the `IdentityIndex` orchestrates.

The Connected rail (RFC 0006) and timeline routes both use this single helper.
Going forward, anything that wants "neighbors of X" goes through here, not
through ad-hoc joins.

### Layer 4: dialect quirks

We use a small set of SQLite-isms. List them, document them, isolate
translation:

| SQLite-ism                                | Used for                       | ClickHouse / Postgres equivalent                                     |
| ----------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `INTEGER PRIMARY KEY AUTOINCREMENT`       | most ID columns                | `Int64` + identity or `BIGSERIAL`                                    |
| `INSERT OR IGNORE`                        | upsert helpers                 | `ON CONFLICT DO NOTHING`                                             |
| `?` positional binds                      | everywhere                     | named params                                                         |
| `TEXT` for ISO timestamps                 | retention                      | native `DateTime` types                                              |
| Partial indexes (`WHERE col IS NOT NULL`) | RFC 0004 indices               | varies; ClickHouse has different mechanism                           |
| `json_each(col)`                          | (was) `trace_ids_json` lookups | not needed after RFC 0007 revision — we now use a join table instead |

The `json_each` row was originally for the JSON-array approach in early RFC 0007
drafts. RFC 0007 was revised to use a `profile_trace_index` join table
specifically to **avoid** introducing this dialect-quirk. New code introduced by
0004 / 0007 is constructed to stay within the portable subset of SQL where
reasonable; new SQLite-isms that _do_ slip in get a row in this table at the
time they're added, not retroactively.

Each dialect adapter (when we write one) maintains a translation map. We don't
write a SQL parser — we write SQL templates per dialect for the ~30 statements
that need it.

### What this RFC does NOT change

- No SQL queries change.
- No table shapes change.
- No migration changes.
- No new external dependencies.

The whole RFC is type-shape work, ~800 LOC of mechanical refactor, no behavior
change.

## Acceptance criteria

1. `CollectorConfig`
   ([framework/collector.ts](../packages/obs-collector/src/framework/collector.ts))
   gains an optional `sqlDb?: SqlDb` field. When unset, the framework defaults
   to `new D1Adapter(env.DB)`.
2. All existing `*-store.ts` constructors take `SqlDb` instead of `D1Database`.
   Tests still pass.
3. The ~45 direct `c.env.DB.prepare(...)` call sites in plugins are migrated to
   go through their respective stores (or through `IdentityIndex` for
   cross-signal lookups). After this RFC, `c.env.DB` is referenced only inside
   the framework's adapter wiring.
4. A new `IdentityIndex` class exists, used by both
   `/internal/timeline/:sessionId` (refactored) and
   `/internal/connected/:kind/:id` (new in RFC 0006).
5. New code (RFC 0004's `interaction_id` queries, RFC 0007's `profile_blobs`) is
   written against `SqlDb` from day one, not against `D1Database`.
6. Existing tests (e.g.
   [`stage6.test.ts`](../packages/obs-collector/src/lib/stage6.test.ts)) reuse a
   shared `MemSqlDb` test double instead of hand-rolling one.
7. **Out of scope** — `BetterSqliteAdapter` and `ClickHouseAdapter` are
   deliberately not built. `apps/collector` is a Cloudflare Worker today and the
   workspace has no embedded-SQLite runtime or `better-sqlite3` dependency to
   exercise. They become real work the moment a Node/Bun embedded-SQLite
   deployment is actually attempted (or scale forces an engine swap), and the
   seam this RFC builds is what makes that work small.

## Non-goals

- **Migrate to ClickHouse.** Not now. The RFC builds the seam; the migration is
  a separate decision, made when concrete scale pain shows up on a real
  deployment.
- **A query language layer.** Out of scope. Each store has its own typed
  methods. We're not building UQL.
- **Sharding / read replicas / multi-region.** Way out of scope.
- **Schema migrations across engines.** Migrations stay SQLite-shaped. When we
  add a second engine, we ship a parallel migration set, not a translator.

## Risks and open questions

- **Risk: too much abstraction, slowed velocity.** A common failure mode of this
  kind of refactor. Mitigation: only `SqlDb` and `IdentityIndex` are introduced
  now; per-signal store interfaces are added _as we touch each store_, not in
  one big-bang PR.
- **`Promise.all` fan-out on D1.** D1 doesn't support real parallelism well;
  concurrent prepares serialize. The `IdentityIndex` may not be faster than
  sequential. Measure before optimizing.
- **Test double location.** Where does `MemSqlDb` live — `lib/test-utils/`?
  Probably yes, exported from a separate entry to keep production bundles slim.
- **Should `Store` interfaces live in `@obsunified/types`?** Probably yes, so a
  host app can write its own implementation without depending on
  `@obsunified/collector`. Defer until someone asks.

## Why this RFC at all

It's tempting to skip this and write RFC 0007's `profile_blobs` code directly
against D1. That's how every observability tool ends up with a one-engine
architecture they can't escape from. The cost of this RFC is small (a week of
refactoring) and it's the difference between "we can swap storage when we need
to" and "the team that adopts us at scale forks the project."

The RFC is a load-bearing piece of the umbrella RFC 0003 specifically because
the unified-stack thesis assumes long-term durability of the architecture.
SQLite is great. SQLite is also wrong eventually. Be ready.
