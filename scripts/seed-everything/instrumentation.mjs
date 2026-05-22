// Bootstrap obs-unified telemetry BEFORE the seeder imports anything else.
// Loaded via `node --import ./instrumentation.mjs run.mjs`.
//
// Inits the @obs-unified/sdk pointed at the local collector with the
// obs-dashboard ingest key, plus the undici instrumentation so every
// outbound fetch the seeder makes becomes a `HTTP POST` client span.
// The collector's request middleware traces the receiving side (already
// in place), and the two are linked via the W3C traceparent header.

import { init } from "@obs-unified/sdk";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";

const COLLECTOR = process.env.OBS_COLLECTOR_URL ?? "http://localhost:8790";
const INGEST_KEY = process.env.OBS_DASHBOARD_INGEST_KEY ?? "";

if (!INGEST_KEY) {
	console.warn(
		"[seed-everything] OBS_DASHBOARD_INGEST_KEY not set — telemetry will be rejected by the collector. " +
			"Get the key from `apps/collector/.dev.vars`.",
	);
}

const shutdown = init({
	collectorUrl: COLLECTOR,
	ingestKey: INGEST_KEY,
	serviceName: "obs-seeder",
	serviceVersion: "0.1.0",
	environment: "dev",
	projectId: "obs-dashboard",
});

// Auto-instrument Node's fetch (which is undici under the hood).
// Every fetch the seeder makes — to /v1/usage, /v1/traces, /internal/* —
// becomes a client span with http.method, url.full, http.response.status_code.
registerInstrumentations({
	instrumentations: [new UndiciInstrumentation()],
});

// Flush spans before the process exits. Both the normal exit path and
// SIGINT (Ctrl-C) need this — without it, the BatchSpanProcessor's last
// batch never leaves the process.
const drain = async () => {
	try {
		await shutdown();
	} catch {
		// Swallow — shutdown errors mustn't mask seeder errors.
	}
};

process.on("beforeExit", drain);
process.on("SIGINT", async () => {
	await drain();
	process.exit(130);
});
process.on("SIGTERM", async () => {
	await drain();
	process.exit(143);
});
