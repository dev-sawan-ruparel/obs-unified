// ── Primitives ──

export type Primitive = string | number | boolean | null;
export type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

// CollectorEnv / CollectorRouteContext / CollectorApp moved to
// @obs-unified/obs-collector — they reference Cloudflare Workers ambient
// globals and pollute non-worker consumers like the web dashboard.
