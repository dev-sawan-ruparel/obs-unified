// Backend entry point. Run with `node --import tsx src/server.ts`.
//
// Pre-wired with `@obsunified/telemetry-sdk` — every inbound request
// gets a root span, the x-obs-interaction header is stamped onto it,
// child spans / logs / AI calls inherit. The dashboard's "click that
// caused this trace" pivot works out of the box.

import { serve } from "@hono/node-server";
import {
	createLogger,
	createRequestSpan,
	flushAICalls,
	flushLogs,
	flushSpans,
	initObservability,
	recordFeatureFlag,
	runWithSpan,
	stampInteractionFromRequest,
} from "@obsunified/telemetry-sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";

initObservability({
	collectorUrl: process.env.OBS_COLLECTOR_URL ?? "__COLLECTOR_URL__",
	apiKey: process.env.OBS_INGEST_KEY ?? "dev-ingest-key",
	serviceName: "__APP_NAME__-api",
	environment: process.env.OBS_ENVIRONMENT ?? "dev",
	serviceVersion: process.env.OBS_SERVICE_VERSION ?? "0.1.0",
	commitSha: process.env.OBS_COMMIT_SHA,
});

const log = createLogger("__APP_NAME__-api");
const app = new Hono();

app.use(
	"*",
	cors({
		origin: "*",
		allowHeaders: [
			"Content-Type",
			"Authorization",
			"X-Obs-Session-Id",
			"x-obs-interaction",
		],
	}),
);

app.use("*", async (c, next) => {
	const span = createRequestSpan(
		"__APP_NAME__-api",
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
	recordFeatureFlag("hello_banner_v2", true);
	log.info("hello called");
	return c.json({ message: "hello, world", at: new Date().toISOString() });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
	console.log(`listening on http://localhost:${info.port}`);
});
export default app;
