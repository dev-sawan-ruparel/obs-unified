# @obsunified/types

Shared TypeScript types, constants, and a typed REST client for the obs-unified
collector. Zero-runtime; intended to be imported by the SDK packages, the
dashboard, and any external consumer that talks to the collector's HTTP API.

```ts
import { type SpanRecord, type LogRecord } from "@obsunified/types";
import { INTERACTION_HEADER } from "@obsunified/types/constants";
import { createApiClient } from "@obsunified/types/api-client";

const api = createApiClient({ baseUrl: "https://obs.my-app.com" });
const spans = await api.spans.list({ limit: 100 });
```

Three subpath entries:

| Entry          | Purpose                                               |
| -------------- | ----------------------------------------------------- |
| `.`            | Type-level definitions for every signal table         |
| `./constants`  | Wire-format constants (headers, attribute keys)       |
| `./api-client` | Typed `fetch`-based client for the dashboard read API |

The `./api-client` entry has an optional peer-dep on `hono` for its `Context`
type when used inside a Worker; standalone consumers don't need it.

## Runtime lineage

`@obsunified/types/lineage` holds the pure helpers shared by all SDKs and the collector. It never reads `process`; callers pass `env`.

- `normalizeEnvironment(raw)`: lowercase and trim, `production` to `prod`, `development` to `dev`, `test` unchanged, empty to `default`.
- `resolveLineageFromSources(config, env, configured?)` and `buildLineageAttributesFromSources(config, env, configured?)`: resolve `environment`, `serviceVersion`, `commitSha`, `configDigest` and emit the wire attributes.

Options: `environment`, `serviceVersion`, `commitSha`, `configDigest`. Env vars read: `OBS_ENVIRONMENT`, `NODE_ENV`, `OBS_SERVICE_VERSION`, `OTEL_SERVICE_VERSION`, `OBS_COMMIT_SHA`, `GITHUB_SHA`, `OBS_CONFIG_DIGEST`. See the SDK READMEs for `recordFeatureFlag`.
