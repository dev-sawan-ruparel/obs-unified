const RECENT_TRACE_IDS_MAX = 128;
const recentTraceIds = new Set();

function obsConfig() {
	return {
		collectorUrl:
			process.env.OBS_COLLECTOR_URL || "http://host.docker.internal:8790",
		apiKey:
			process.env.OBS_INGEST_KEY ||
			"obs_default_60738b1b3c903a2f6e8a504e92d8444872e17871acd04504",
		serviceName: process.env.OTEL_SERVICE_NAME || "otel-demo-service",
	};
}

function rememberTraceId(traceId) {
	if (!traceId) return;
	recentTraceIds.add(traceId);
	while (recentTraceIds.size > RECENT_TRACE_IDS_MAX) {
		const first = recentTraceIds.values().next().value;
		recentTraceIds.delete(first);
	}
}

function drainTraceIds() {
	const traceIds = Array.from(recentTraceIds);
	recentTraceIds.clear();
	return traceIds;
}

async function startObsUnified() {
	const config = obsConfig();
	const sdk = await import("@obs-unified/telemetry-sdk");
	sdk.enableProcessMetrics({
		collectorUrl: config.collectorUrl,
		apiKey: config.apiKey,
		serviceName: config.serviceName,
		intervalMs: 30_000,
	});

	if (config.serviceName !== "payment") return;

	try {
		const pprof = require("@datadog/pprof");
		sdk.startProfiler({
			collectorUrl: config.collectorUrl,
			apiKey: config.apiKey,
			serviceName: config.serviceName,
			profileType: "cpu",
			intervalMs: 60_000,
			agent: "datadog-pprof",
			capture: async () => {
				const profile = await pprof.time.profile({ durationMillis: 60_000 });
				const blob = await pprof.encode(profile);
				return {
					blob,
					durationMs: 60_000,
					traceIds: drainTraceIds(),
				};
			},
		});
	} catch (err) {
		console.warn("[obs-unified] profiling disabled", err);
	}
}

startObsUnified().catch((err) => {
	console.warn("[obs-unified] startup failed", err);
});

module.exports = { recordObsTraceId: rememberTraceId };
