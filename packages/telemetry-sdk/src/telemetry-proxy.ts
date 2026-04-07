/**
 * Admin telemetry proxy router (from Presence).
 * Proxies admin dashboard requests to the collector worker.
 */

import type { TelemetryProxyEnv } from "@obs/types";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

interface TelemetryProxyOptions<E extends TelemetryProxyEnv> {
	middleware?: MiddlewareHandler<{ Bindings: E }>;
}

export const createTelemetryProxyRouter = <E extends TelemetryProxyEnv>(
	options?: TelemetryProxyOptions<E>,
) => {
	const router = new Hono<{ Bindings: E }>();

	if (options?.middleware) {
		router.use("*", options.middleware);
	}

	const proxy = async (
		collectorUrl: string,
		token: string,
		path: string,
		query: string,
	) => {
		const url = `${collectorUrl}${path}${query ? `?${query}` : ""}`;
		const response = await fetch(url, {
			headers: token ? { "X-Collector-Token": token } : {},
		});
		const text = await response.text();
		try {
			const data = JSON.parse(text);
			return new Response(JSON.stringify(data), {
				status: response.status,
				headers: { "Content-Type": "application/json" },
			});
		} catch {
			return new Response(
				JSON.stringify({
					error: "Collector error",
					status: response.status,
					body: text,
				}),
				{
					status: 502,
					headers: { "Content-Type": "application/json" },
				},
			);
		}
	};

	router.get("/telemetry", (c) =>
		proxy(
			c.env.TELEMETRY_COLLECTOR_URL,
			c.env.TELEMETRY_COLLECTOR_TOKEN,
			"/internal/telemetry/overview",
			new URL(c.req.url).search.slice(1),
		),
	);

	router.get("/telemetry/traces/:traceId", (c) =>
		proxy(
			c.env.TELEMETRY_COLLECTOR_URL,
			c.env.TELEMETRY_COLLECTOR_TOKEN,
			`/internal/telemetry/traces/${encodeURIComponent(c.req.param("traceId"))}`,
			"",
		),
	);

	router.get("/telemetry/issues", (c) =>
		proxy(
			c.env.TELEMETRY_COLLECTOR_URL,
			c.env.TELEMETRY_COLLECTOR_TOKEN,
			"/internal/telemetry/issues",
			new URL(c.req.url).search.slice(1),
		),
	);

	router.get("/telemetry/issues/detail", (c) =>
		proxy(
			c.env.TELEMETRY_COLLECTOR_URL,
			c.env.TELEMETRY_COLLECTOR_TOKEN,
			"/internal/telemetry/issues/detail",
			new URL(c.req.url).search.slice(1),
		),
	);

	router.get("/telemetry/export", async (c) => {
		const url = `${c.env.TELEMETRY_COLLECTOR_URL}/internal/telemetry/export${new URL(c.req.url).search}`;
		const token = c.env.TELEMETRY_COLLECTOR_TOKEN;
		const response = await fetch(url, {
			headers: token ? { "X-Collector-Token": token } : {},
		});
		return new Response(response.body, {
			status: response.status,
			headers: Object.fromEntries(response.headers),
		});
	});

	router.get('/telemetry/logs', (c) =>
    proxy(c.env.TELEMETRY_COLLECTOR_URL, c.env.TELEMETRY_COLLECTOR_TOKEN,
      '/internal/logs/overview', new URL(c.req.url).search.slice(1)))

  router.get('/telemetry/ai', (c) =>
    proxy(c.env.TELEMETRY_COLLECTOR_URL, c.env.TELEMETRY_COLLECTOR_TOKEN,
      '/internal/ai/overview', new URL(c.req.url).search.slice(1)))

  // Usage query routes
	router.get("/usage", (c) =>
		proxy(
			c.env.TELEMETRY_COLLECTOR_URL,
			c.env.TELEMETRY_COLLECTOR_TOKEN,
			"/internal/usage/overview",
			new URL(c.req.url).search.slice(1),
		),
	);

	router.get("/usage/stream", (c) => {
		const searchParams = new URL(c.req.url).search.slice(1);
		return streamSSE(c, async (stream) => {
			while (true) {
				if (c.req.raw.signal.aborted) break;
				try {
					const response = await fetch(
						`${c.env.TELEMETRY_COLLECTOR_URL}/internal/usage/overview${searchParams ? `?${searchParams}` : ""}`,
						{ headers: c.env.TELEMETRY_COLLECTOR_TOKEN ? { "X-Collector-Token": c.env.TELEMETRY_COLLECTOR_TOKEN } : {} }
					);
					if (response.ok) {
						const text = await response.text();
						await stream.writeSSE({ data: text, event: "usage-update" });
					}
				} catch (e) {
					console.error("SSE Streaming Error:", e);
				}
				await new Promise(r => setTimeout(r, 5000));
			}
		});
	});

	router.get("/usage/sessions/:sessionId", (c) =>
		proxy(
			c.env.TELEMETRY_COLLECTOR_URL,
			c.env.TELEMETRY_COLLECTOR_TOKEN,
			`/internal/usage/sessions/${encodeURIComponent(c.req.param("sessionId"))}`,
			"",
		),
	);

	router.get("/usage/replays/:sessionId", (c) =>
		proxy(
			c.env.TELEMETRY_COLLECTOR_URL,
			c.env.TELEMETRY_COLLECTOR_TOKEN,
			`/v1/query/replays/${encodeURIComponent(c.req.param("sessionId"))}`,
			"",
		),
	);

	return router;
};
