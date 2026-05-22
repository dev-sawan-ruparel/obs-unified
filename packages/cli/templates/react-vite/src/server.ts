// Backend entry point. Run with `node --import tsx src/server.ts`.
//
// Pre-wired with `@obs-unified/telemetry-sdk` — every inbound request
// gets a root span, the x-obs-interaction header is stamped onto it,
// child spans / logs / AI calls inherit. The dashboard's "click that
// caused this trace" pivot works out of the box.

import {
	createLogger,
	createRequestSpan,
	flushAICalls,
	flushLogs,
	initObservability,
	runWithSpan,
	stampInteractionFromRequest,
} from "@obs-unified/telemetry-sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";

initObservability({
	collectorUrl: process.env.OBS_COLLECTOR_URL ?? "http://localhost:8790",
	apiKey: process.env.OBS_INGEST_KEY ?? "dev-ingest-key",
	serviceName: "__APP_NAME__-api",
});

const log = createLogger("__APP_NAME__-api");
const app = new Hono();

app.use(
	"*",
	cors({
		origin: "*",
		allowHeaders: ["Content-Type", "Authorization", "x-obs-interaction"],
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
		await Promise.all([flushLogs(), flushAICalls()]).catch(() => {});
	}
});

app.get("/api/hello", (c) => {
	log.info("hello called");
	return c.json({ message: "hello, world", at: new Date().toISOString() });
});

const port = Number(process.env.PORT ?? 3000);
console.log(`listening on http://localhost:${port}`);
export default { port, fetch: app.fetch };
