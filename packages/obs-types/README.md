# @obs-unified/types

Shared TypeScript types, constants, and a typed REST client for the obs-unified
collector. Zero-runtime; intended to be imported by the SDK packages, the
dashboard, and any external consumer that talks to the collector's HTTP API.

```ts
import { type SpanRecord, type LogRecord } from "@obs-unified/types";
import { INTERACTION_HEADER } from "@obs-unified/types/constants";
import { createApiClient } from "@obs-unified/types/api-client";

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
