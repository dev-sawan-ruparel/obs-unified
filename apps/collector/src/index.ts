import {
	createAnalysesRunHandler,
	createDefaultCollectorApp,
	createRetentionCleanupHandler,
	createIngestAuth,
	createDashboardAuth,
	evaluateAllRules,
	type CollectorEnv,
} from "@obs/collector";
import {
	createLogger,
	createRequestSpan,
	flushAICalls,
	flushLogs,
	initObservability,
	parseTraceparent,
	type RequestSpan,
	runWithSpan,
	stampInteractionFromRequest,
	withChildSpan,
	wrapD1,
	wrapR2,
} from "@obs/telemetry-sdk";

export { TailHub } from "@obs/collector";

/**
 * Collector worker.
 *
 * Environment variables:
 *   INGEST_KEY        — Write-only API key for SDK ingest (required in production)
 *   DASHBOARD_PASSWORD — Password for the dashboard login
 *   ALLOWED_ORIGINS    — Comma-separated allowed origins for CORS
 *   RETENTION_HOURS    — Data retention window in hours (default: 72)
 *   OBS_DASHBOARD_INGEST_KEY — Enables self-instrumentation into the
 *                              `obs-dashboard` project. See
 *                              SELF_INSTRUMENTATION.md.
 *
 * For local dev, set ALLOW_UNAUTHENTICATED="true" to bypass ingest auth.
 */

// ── Self-instrumentation ─────────────────────────────────────────────────────
//
// The collector dogfoods itself by POSTing its own telemetry to its own
// /v1/* endpoints, authenticated with the obs-dashboard project ingest key.
//
// LOOP HAZARD — read SELF_INSTRUMENTATION.md before changing anything in
// this section. Every self-emitted POST stamps the request with
// `X-Telemetry-Self: 1`; the request middleware below short-circuits when
// it sees that header. Removing either side of that contract creates an
// infinite trace-export loop that takes down the worker.

const SELF_HEADER = "X-Telemetry-Self";
const SELF_HEADER_VALUE = "1";
const SELF_SERVICE_NAME = "obs-collector";
const SELF_INSTRUMENTED_PREFIX = ["/v1/", "/internal/"];

let observabilityInited = false;
const ensureObservability = (env: CollectorEnv): boolean => {
	if (!env.OBS_DASHBOARD_INGEST_KEY || !env.OBS_COLLECTOR_SELF_URL) return false;
	if (!observabilityInited) {
		initObservability({
			collectorUrl: env.OBS_COLLECTOR_SELF_URL,
			apiKey: env.OBS_DASHBOARD_INGEST_KEY,
			serviceName: SELF_SERVICE_NAME,
			extraHeaders: { [SELF_HEADER]: SELF_HEADER_VALUE },
		});
		observabilityInited = true;
	}
	return true;
};

const cronLogger = createLogger("obs-collector.cron");
const collectorLogger = createLogger("obs-collector");

const shouldInstrument = (request: Request): boolean => {
	if (request.headers.get(SELF_HEADER) === SELF_HEADER_VALUE) return false;
	const path = new URL(request.url).pathname;
	return SELF_INSTRUMENTED_PREFIX.some((p) => path.startsWith(p));
};

const exportSpan = async (env: CollectorEnv, span: RequestSpan): Promise<void> => {
	if (!env.OBS_COLLECTOR_SELF_URL || !env.OBS_DASHBOARD_INGEST_KEY) return;
	try {
		await fetch(`${env.OBS_COLLECTOR_SELF_URL}/v1/traces`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.OBS_DASHBOARD_INGEST_KEY}`,
				// Loop guard — the very next worker invocation that sees this
				// header will skip self-instrumentation. Do not remove.
				[SELF_HEADER]: SELF_HEADER_VALUE,
			},
			body: JSON.stringify(span.toOtlpExportRequest()),
			signal: AbortSignal.timeout(5_000),
		});
	} catch {
		// Swallowed by design — a failed self-export must not raise into the
		// real request path. The buffered logger already retries via flushLogs.
	}
};

// ── App setup ───────────────────────────────────────────────────────────────

const createApp = (env: CollectorEnv) => {
	// Ingest auth now validates against the ingest_keys table. On first request,
	// any legacy env.INGEST_KEY is auto-registered as a bootstrap key on the
	// default project (see auth/ingest-auth.ts) so existing deployments keep
	// working without manual migration.
	const ingestAuth = createIngestAuth({
		allowUnauthenticated: env.ALLOW_UNAUTHENTICATED === "true",
	});

	const dashboardAuth = env.DASHBOARD_PASSWORD
		? createDashboardAuth({ password: env.DASHBOARD_PASSWORD })
		: undefined;

	return createDefaultCollectorApp({
		auth: { middleware: ingestAuth },
		allowedOrigins: env.ALLOWED_ORIGINS,
		dashboardAuth,
		logger: collectorLogger,
		// Wires the SDK's child-span helper through the framework so handlers
		// like /internal/ask can attach LLM hops as nested spans without the
		// framework package importing telemetry-sdk. Upfront attributes are
		// stamped immediately; the wrapped fn receives the child span handle
		// so it can add post-hoc attributes (e.g., LLM token counts that
		// only exist after the response arrives).
		withChildSpan: (name, fn, attributes) =>
			withChildSpan(name, async (child) => {
				if (attributes) {
					for (const [k, v] of Object.entries(attributes))
						child.setAttribute(k, v);
				}
				return fn(child);
			}),
	});
};

// Lazily create the app on first request to access env
let app: ReturnType<typeof createApp> | null = null;

const cleanup = createRetentionCleanupHandler({ logger: cronLogger });
// Pass a tracer so the narrative LLM call inside `runAllDueAnalyses` lands
// as a child of the `cron.analyses_run` parent span. The bridge mirrors the
// one in `createApp` — bridges the framework's ChildSpanRunner shape onto
// the SDK's `withChildSpan(name, fn(child))`.
const analysesRun = createAnalysesRunHandler({
	logger: cronLogger,
	tracer: (name, fn, attributes) =>
		withChildSpan(name, async (child) => {
			if (attributes) {
				for (const [k, v] of Object.entries(attributes))
					child.setAttribute(k, v);
			}
			return fn(child);
		}),
});

// ── Cron handlers ───────────────────────────────────────────────────────────

const runCronWithTelemetry = async (
	env: CollectorEnv,
	ctx: ExecutionContext,
	cronName: string,
	work: (tracedEnv: CollectorEnv) => Promise<void>,
): Promise<void> => {
	const selfEnabled = ensureObservability(env);
	if (!selfEnabled) {
		await work(env);
		return;
	}
	// Replace env.DB / env.REPLAYS_BUCKET with traced bindings for the cron
	// run. Stores and replay code already take these from env; no plugin
	// code changes are needed.
	const tracedEnv: CollectorEnv = {
		...env,
		DB: wrapD1(env.DB),
		REPLAYS_BUCKET: env.REPLAYS_BUCKET
			? wrapR2(env.REPLAYS_BUCKET, { bucketName: "obs-demo-replays" })
			: env.REPLAYS_BUCKET,
	};
	const span = createRequestSpan(SELF_SERVICE_NAME, `cron.${cronName}`);
	span.setAttribute("cron.name", cronName);
	try {
		await runWithSpan(span, () => work(tracedEnv));
		span.setStatus(1);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		span.setStatus(2, msg);
		cronLogger.error(`cron ${cronName} failed`, {
			cron: cronName,
			error: msg,
		});
		throw err;
	} finally {
		span.end();
		ctx.waitUntil(
			Promise.all([exportSpan(env, span), flushLogs(), flushAICalls()]).catch(
				() => undefined,
			),
		);
	}
};

// Cron dispatcher: route each trigger to the appropriate handler by event.cron.
// - "* * * * *"    → run any due Analyses (RFC 0002 — 60s freshness for Tier 0)
// - "*/5 * * * *"  → alert evaluator
// - "0 * * * *"    → hourly retention cleanup
async function scheduled(
	event: ScheduledEvent,
	env: CollectorEnv,
	ctx: ExecutionContext,
): Promise<void> {
	if (event.cron === "*/5 * * * *") {
		ctx.waitUntil(
			runCronWithTelemetry(env, ctx, "alerts_evaluate", async (tracedEnv) => {
				await evaluateAllRules(tracedEnv, {
					logger: cronLogger,
					tracer: (name, fn, attributes) =>
						withChildSpan(name, async (child) => {
							if (attributes) {
								for (const [k, v] of Object.entries(attributes))
									child.setAttribute(k, v);
							}
							return fn(child);
						}),
				});
			}),
		);
		return;
	}
	if (event.cron === "0 * * * *") {
		await runCronWithTelemetry(env, ctx, "retention_cleanup", (tracedEnv) =>
			cleanup.scheduled(event, tracedEnv, ctx),
		);
		return;
	}
	// Default — every-minute analyses tick.
	await runCronWithTelemetry(env, ctx, "analyses_run", (tracedEnv) =>
		analysesRun.scheduled(event, tracedEnv, ctx),
	);
}

// ── Fetch handler ───────────────────────────────────────────────────────────

export default {
	async fetch(request: Request, env: CollectorEnv, ctx: ExecutionContext) {
		if (!app) app = createApp(env);
		const selfEnabled = ensureObservability(env);

		// Loop-guard short-circuit: any inbound request that already carries
		// the self-telemetry header was emitted by us and must not be traced
		// again, otherwise its export would re-enter this branch infinitely.
		// Same path is taken when self-instrumentation is disabled (no key)
		// or the request targets a path we don't instrument (e.g. /health).
		if (!selfEnabled || !shouldInstrument(request)) {
			return app.fetch(request, env, ctx);
		}

		const url = new URL(request.url);
		// Continue the caller's trace when they sent a W3C traceparent
		// header — preserves trace_id and links via parent_span_id, so
		// distributed traces from instrumented Node/Go/Rust services land
		// as one tree rather than disconnected fragments. Falls back to
		// minting a fresh trace id when the header is absent or invalid.
		const incoming = parseTraceparent(request.headers.get("traceparent"));
		const span = createRequestSpan(
			SELF_SERVICE_NAME,
			`${request.method} ${url.pathname}`,
			incoming,
		);
		span.setAttribute("http.request.method", request.method);
		span.setAttribute("url.path", url.pathname);
		// RFC 0004 — propagate the click-scoped correlation id from the
		// inbound x-obs-interaction header onto the root span. No-op
		// when the header is absent or malformed.
		stampInteractionFromRequest(span, request);

		// Replace env.DB / env.REPLAYS_BUCKET with traced bindings for the
		// duration of this request so plugins/handlers reading `c.env.*`
		// auto-emit child spans for every query / object op. The unwrapped
		// env stays available for self-export below (which doesn't touch D1
		// or R2 directly).
		const tracedEnv: CollectorEnv = {
			...env,
			DB: wrapD1(env.DB),
			REPLAYS_BUCKET: env.REPLAYS_BUCKET
				? wrapR2(env.REPLAYS_BUCKET, { bucketName: "obs-demo-replays" })
				: env.REPLAYS_BUCKET,
		};

		try {
			const response = await runWithSpan(span, () =>
				(app as NonNullable<typeof app>).fetch(request, tracedEnv, ctx),
			);
			span.setAttribute("http.response.status_code", response.status);
			span.setStatus(response.status >= 500 ? 2 : 1);
			return response;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			span.setStatus(2, msg);
			throw err;
		} finally {
			span.end();
			const drain = Promise.all([
				exportSpan(env, span),
				flushLogs(),
				flushAICalls(),
			]).catch(() => undefined);
			// Miniflare drops `ctx.waitUntil` once the response resolves, which
			// loses every log/span emitted *after* the inner request settled —
			// e.g. the post-LLM logs in /internal/ask. Awaiting in dev keeps
			// them. Production CF Workers honor waitUntil, so we use it there.
			if (env.OBS_SELF_AWAIT_EXPORTS === "true") {
				await drain;
			} else {
				ctx.waitUntil(drain);
			}
		}
	},
	scheduled,
};
