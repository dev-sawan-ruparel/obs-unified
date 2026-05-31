# Examples

Use this page to pick the right starting point. Runnable examples are things you
can clone, scaffold, or run locally. Reference examples are docs and snippets to
copy into an existing app.

## Fastest Paths

| Goal | Start here | Type |
| --- | --- | --- |
| Try obs-unified with realistic traffic | [`demo/`](../demo/) | Runnable demo |
| Scaffold a new React + Hono app | [`packages/cli/templates/react-vite/`](../packages/cli/templates/react-vite/) via `obs-unified create` | Runnable template |
| Add obs-unified to an existing React + Hono app | [`docs/howto/instrument-react-hono.md`](./howto/instrument-react-hono.md) | Walkthrough |
| Add obs-unified to an existing Python Flask app | [`docs/howto/instrument-python-flask.md`](./howto/instrument-python-flask.md) | Walkthrough |
| Add browser analytics only | [`packages/analytics-sdk/README.md`](../packages/analytics-sdk/README.md) | Reference |
| Add TypeScript backend telemetry | [`packages/telemetry-sdk/README.md`](../packages/telemetry-sdk/README.md) | Reference |
| Instrument Python, JVM, or .NET | [`docs/recipes/README.md`](./recipes/README.md) | Recipes |

## Runnable Examples

| Example | What it shows | Run / entry point |
| --- | --- | --- |
| [`packages/cli/templates/react-vite/`](../packages/cli/templates/react-vite/) | React + Vite frontend, Hono Node API, `AnalyticsProvider`, backend spans, and click-to-trace propagation | `obs-unified create my-app`, choose React + Vite + Hono |
| [`packages/cli/templates/vanilla-ts/`](../packages/cli/templates/vanilla-ts/) | Browser-only Vite + TypeScript analytics | `obs-unified create my-app`, choose Vanilla TypeScript |
| [`packages/cli/templates/hono-workers/`](../packages/cli/templates/hono-workers/) | Hono on Cloudflare Workers with backend telemetry wiring | `obs-unified create my-api`, choose Hono on Workers |
| [`apps/obs-demo/`](../apps/obs-demo/) | AI calls, RAG, tool calls, session tracking, and evaluation scenarios | `pnpm dev`, then `curl http://127.0.0.1:8787/api/demo/run-all` |
| [`apps/collector-node/`](../apps/collector-node/) | Standalone Node collector with Postgres + MinIO | `docker compose up -d` from `apps/collector-node` |
| [`demo/`](../demo/) | OpenTelemetry Astronomy Shop feeding obs-unified with polyglot microservice traffic | `pnpm demo:setup`, `pnpm demo:preflight`, `pnpm demo:up` |

## SDK Examples

| Runtime | Example | Notes |
| --- | --- | --- |
| Node.js / TypeScript | [`sdks/node/examples/basic.ts`](../sdks/node/examples/basic.ts) | First-party Node SDK usage |
| Node.js / TypeScript | [`sdks/node/examples/smoke.mjs`](../sdks/node/examples/smoke.mjs) | Lightweight SDK smoke path |
| Go | [`sdks/go/examples/basic/main.go`](../sdks/go/examples/basic/main.go) | Go SDK init and span conventions |
| Rust | [`sdks/rust/examples/basic.rs`](../sdks/rust/examples/basic.rs) | Rust SDK init and helper usage |

## Instrumentation Guides

| App shape | Guide |
| --- | --- |
| React + Hono | [`docs/howto/instrument-react-hono.md`](./howto/instrument-react-hono.md) |
| Python + Flask | [`docs/howto/instrument-python-flask.md`](./howto/instrument-python-flask.md) |
| Browser / React analytics | [`packages/analytics-sdk/README.md`](../packages/analytics-sdk/README.md) |
| TypeScript backend / Workers | [`packages/telemetry-sdk/README.md`](../packages/telemetry-sdk/README.md) |
| Deeper backend instrumentation | [`packages/telemetry-sdk/INSTRUMENTATION_GUIDE.md`](../packages/telemetry-sdk/INSTRUMENTATION_GUIDE.md) |
| Profiling / pprof | [`docs/howto/profiling.md`](./howto/profiling.md) |
| eBPF / host metrics | [`docs/howto/ebpf.md`](./howto/ebpf.md) |

## Language Recipes

| Runtime | Recipe |
| --- | --- |
| Python | [`docs/recipes/python.md`](./recipes/python.md) |
| JVM / Java / Kotlin | [`docs/recipes/jvm.md`](./recipes/jvm.md) |
| .NET | [`docs/recipes/dotnet.md`](./recipes/dotnet.md) |
| First-party SDK overview | [`sdks/README.md`](../sdks/README.md) |
| SDK skeleton for contributors | [`sdks/_template/README.md`](../sdks/_template/README.md) |

## Migration Examples

| Source | Guide |
| --- | --- |
| Sentry | [`docs/migrate/from-sentry.md`](./migrate/from-sentry.md) |
| PostHog | [`docs/migrate/from-posthog.md`](./migrate/from-posthog.md) |
| Honeycomb | [`docs/migrate/from-honeycomb.md`](./migrate/from-honeycomb.md) |
| Old `@obs/*` package scope | [`docs/migrate/from-obs-scope.md`](./migrate/from-obs-scope.md) |

## Verification

After wiring any example, verify the collector and browser CORS path:

```bash
obs-unified doctor http://localhost:8790 --origin http://localhost:5173
```

For browser examples, the origin should match the app you are testing. For the
Astronomy Shop demo, use `http://localhost:8080`.
