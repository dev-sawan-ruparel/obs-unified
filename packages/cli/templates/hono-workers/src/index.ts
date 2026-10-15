import {
	createLogger,
	createRequestSpan,
	flushAICalls,
	flushLogs,
	flushSpans,
	initObservability,
	runWithSpan,
	stampInteractionFromRequest,
} from "@obsunified/telemetry-sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";

interface Env {
	OBS_COLLECTOR_URL: string;
	OBS_INGEST_KEY: string;
	OBS_ENVIRONMENT?: string;
	OBS_SERVICE_VERSION?: string;
	OBS_COMMIT_SHA?: string;
}

const log = createLogger("__APP_NAME__");
const app = new Hono<{ Bindings: Env }>();

// CORS — allow the obs interaction header through preflight.
app.use(
	"*",
	cors({
		origin: "*",
		allowHeaders: ["Content-Type", "Authorization", "x-obs-interaction"],
	}),
);

// Bootstrap the SDK once per request. Worker isolates are short-lived;
// repeated calls are cheap.
app.use("*", async (c, next) => {
	initObservability({
		collectorUrl: c.env.OBS_COLLECTOR_URL,
		apiKey: c.env.OBS_INGEST_KEY,
		serviceName: "__APP_NAME__",
		// Release lineage powers AutoSRE change correlation and cohort attribution.
		environment: c.env.OBS_ENVIRONMENT ?? "dev",
		serviceVersion: c.env.OBS_SERVICE_VERSION ?? "0.1.0",
		commitSha: c.env.OBS_COMMIT_SHA,
	});
	await next();
});

// Root span + interaction stamping.
app.use("*", async (c, next) => {
	const span = createRequestSpan(
		"__APP_NAME__",
		`${c.req.method} ${c.req.path}`,
	);
	stampInteractionFromRequest(span, c.req.raw);
	try {
		await runWithSpan(span, () => next());
		span.setStatus(c.res.status >= 400 ? 2 : 1);
	} finally {
		span.end();
		await Promise.all([flushSpans(), flushLogs(), flushAICalls()]).catch(
			() => {},
		);
	}
});

app.get("/api/hello", (c) => {
	log.info("hello called");
	return c.json({ message: "hello, world", at: new Date().toISOString() });
});

export default app;
