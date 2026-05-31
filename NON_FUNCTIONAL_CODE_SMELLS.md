# Non-Functional Code Smell Review — obs-unified

> Scope: all non-test, non-generated TypeScript/JS source across `packages/obs-collector`, `packages/telemetry-sdk`, `packages/analytics-sdk`, `sdks/node`, `packages/dashboard`, `apps/*`, and `packages/cli`/`packages/pprof-decoder`.
> Focus: **non-functional** defects (performance, security, reliability, memory, type-safety) only.
> Date: 2026-05-31
> Todo status: unchecked bullets are open; checked bullets are fixed and include the commit/action that closed them.

---

## Cross-cutting patterns (themes behind most findings)

1. **Proxy wrappers breaking WeakMap caches** — wrapping key dependencies like `env.DB` dynamically on every request changes object identities, leading to a complete bypass of in-memory caching systems. *(Resolved)*
2. **Missing security transport attributes** — omitting the `Secure` flag on critical administrative cookies exposes administrative sessions over unencrypted channels. *(Resolved)*
3. **Database connection safety gaps** — missing pool-level error event handling crashes standalone server processes on transient TCP/idle timeouts. *(Resolved)*
4. **Redundant connection setup overhead** — prefixing every single SQL query with session state mutation queries (`SET statement_timeout`) doubles network roundtrips for ingestion routes. *(Resolved)*
5. **Inefficient parsing allocations** — instantiating complex built-in decoders inside high-frequency decoding loops creates heavy garbage collection churn. *(Resolved)*
6. **Numeric box allocation memory bloat** — collecting bytes in standard Javascript arrays rather than typed buffers (`Uint8Array`) triggers dynamic resizing overhead and massive V8 heap growth. *(Resolved)*

---

## HIGH severity

### Security & Auth Bypass
- [x] **`packages/obs-collector/src/auth/dashboard-auth.ts:222`** — Administrative session cookie `obs_session` is set with `Path=/; HttpOnly; SameSite=Strict` but lacks the `Secure` flag, exposing administrative credentials to transmission over unencrypted connections under misconfigured setups. **(Fixed: Conditional `; Secure` attribute attached under HTTPS connections)**
- [x] **`packages/obs-collector/src/auth/ingest-auth.ts:127`** — Token cache is keyed by `c.env.DB` in a `WeakMap`. Because `c.env.DB` is dynamic and proxy-wrapped in `wrapD1` on every request, its object reference changes constantly, causing a 100% cache miss rate and triggering unnecessary database lookups on every single telemetry ingestion. **(Fixed: Unwrapped stable target database reference accessed to key the WeakMap cache)**

### Reliability & Crash Risk
- [x] **`apps/collector-node/src/server.ts:34`** — Node.js standalone server constructs a `pg.Pool` but does not register a `pool.on('error')` handler. Unhandled idle connection drops or transient database TCP resets bubble up as unhandled process exceptions and crash the entire collector server. **(Fixed: Registered `pool.on("error")` handler to catch connection drops safely without process termination)**

---

## MEDIUM severity

### Performance & Latency Overhead
- [x] **`packages/obs-collector/src/lib/sql-db-postgres.ts:141`** — Postgres adapter runs `SET statement_timeout` immediately before the actual SQL query inside the `exec` loop. This doubles network database roundtrips (2 queries per execute call) for all telemetry ingestion statements, introducing high latency overhead in high-throughput standalone setups. **(Fixed: Moved statement timeout configuration to pool `connect` event listener to run once per socket establishment)**

### Memory & GC Bloat
- [x] **`packages/pprof-decoder/src/index.ts:73`** — `Reader.readString` instantiates a new `TextDecoder` instance for every single string in the profile's `stringTable`. Since string tables often contain thousands of entries per profile, this triggers massive GC allocations and high V8 CPU overhead. **(Fixed: Replaced with a single class-level reusable `TextDecoder` instance)**
- [x] **`packages/pprof-decoder/src/index.ts:438`** — `encodePprof` collects serialized output bytes in a standard JS array `out: number[]`. For larger profiles, dynamic array resizing and box-allocation of numeric elements can balloon the V8 heap up to 80MB per call, causing memory spikes and Worker Out-of-Memory (OOM) evictions in resource-constrained environments. **(Fixed: Introduced optimized typed `ByteBuilder` sink to eliminate V8 numeric boxing and heap growth)**

### Type Safety & Compiler Compliance
- [x] **`apps/collector-node/src/server.ts:83`** (and `apps/collector/src/index.ts`) — `auth` and `dashboardAuth` are configured as `as never` due to a mismatch where `createIngestAuth` returns a middleware typed with Hono `Variables` (`{ projectId: string }`) but the framework's `CollectorAuthConfig` does not specify these environment variables/variables generic parameters, forcing unsafe casts that mask API changes. **(Fixed: Widened framework's generic variables configuration types and removed `as never` casts)**

---

## Suggested triage order

1. **Security & Auth Bypass** — Fix WeakMap cache keying identity drift in `ingest-auth.ts` and set the `Secure` flag on `obs_session` in `dashboard-auth.ts`. *(Completed)*
2. **Reliability & Crash Risk** — Register pool-level error handlers in `apps/collector-node/src/server.ts` to prevent process crashes. *(Completed)*
3. **Performance & Latency Overhead** — Optimize the statement timeout handler in the Postgres adapter to eliminate double network roundtrips. *(Completed)*
4. **Memory & GC Bloat** — Refactor `pprof-decoder` string decoding to use a single reusable `TextDecoder` instance and change `encodePprof` to write into pre-allocated/buffered Uint8Arrays. *(Completed)*
5. **Type Safety** — Harmonize Hono middleware generics and type contracts to eliminate the unsafe `as never` casts. *(Completed)*
