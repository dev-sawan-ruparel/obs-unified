/**
 * Usage event proxy router (from Presence).
 * Proxies browser usage events to the collector worker.
 */

import type { TelemetryProxyEnv } from "@obs/types";
import { Hono } from "hono";

interface UsageProxyOptions {
	collectorPath?: string;
	defaultUserAgent?: string;
	countryHeader?: string;
}

export const createUsageProxyRouter = <E extends TelemetryProxyEnv>(
	options?: UsageProxyOptions,
) => {
	const collectorPath = options?.collectorPath ?? "/v1/usage";
	const defaultUserAgent = options?.defaultUserAgent ?? "telemetry-usage-proxy";
	const countryHeader = options?.countryHeader ?? "cf-ipcountry";

	const router = new Hono<{ Bindings: E }>();

	router.post("/events", async (c) => {
		const body = await c.req.text();
		const userAgent = c.req.header("User-Agent") || defaultUserAgent;
		const country = c.req.header(countryHeader) || null;

		const collectorUrl = `${c.env.TELEMETRY_COLLECTOR_URL}${collectorPath}`;
		const token =
			c.env.USAGE_COLLECTOR_INGEST_TOKEN || c.env.TELEMETRY_COLLECTOR_TOKEN;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"User-Agent": userAgent,
		};
		if (token) headers["Authorization"] = `Bearer ${token}`;
		if (country) headers["X-Client-Country"] = country;

		const response = await fetch(collectorUrl, {
			method: "POST",
			headers,
			body,
		});

		const data = await response.json();
		const origin = c.req.header("Origin") || "*";

		return new Response(JSON.stringify(data), {
			status: response.status,
			headers: {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": origin,
			},
		});
	});

	router.options("/events", (c) => {
		c.header("Access-Control-Allow-Origin", c.req.header("Origin") || "*");
		c.header("Access-Control-Allow-Methods", "POST,OPTIONS");
		c.header("Access-Control-Allow-Headers", "Content-Type");
		return c.body(null, 204);
	});

	// --- Proxy for Identify ---
	router.post("/identify", async (c) => {
		const body = await c.req.text();
		const collectorUrl = `${c.env.TELEMETRY_COLLECTOR_URL}/v1/identify`;
		const token = c.env.USAGE_COLLECTOR_INGEST_TOKEN || c.env.TELEMETRY_COLLECTOR_TOKEN;
		
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (token) headers["Authorization"] = `Bearer ${token}`;

		const response = await fetch(collectorUrl, { method: "POST", headers, body });
		const origin = c.req.header("Origin") || "*";

		const textResp = await response.text();
		return new Response(textResp, {
			status: response.status,
			headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin },
		});
	});

	router.options("/identify", (c) => {
		c.header("Access-Control-Allow-Origin", c.req.header("Origin") || "*");
		c.header("Access-Control-Allow-Methods", "POST,OPTIONS");
		c.header("Access-Control-Allow-Headers", "Content-Type");
		return c.body(null, 204);
	});

	// --- Proxy for Replays ---
	router.post("/replays", async (c) => {
		const body = await c.req.text();
		const collectorUrl = `${c.env.TELEMETRY_COLLECTOR_URL}/v1/replays`;
		const token = c.env.USAGE_COLLECTOR_INGEST_TOKEN || c.env.TELEMETRY_COLLECTOR_TOKEN;
		
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (token) headers["Authorization"] = `Bearer ${token}`;

		const response = await fetch(collectorUrl, { method: "POST", headers, body });
		const origin = c.req.header("Origin") || "*";

		const textResp = await response.text();
		return new Response(textResp, {
			status: response.status,
			headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin },
		});
	});

	router.options("/replays", (c) => {
		c.header("Access-Control-Allow-Origin", c.req.header("Origin") || "*");
		c.header("Access-Control-Allow-Methods", "POST,OPTIONS");
		c.header("Access-Control-Allow-Headers", "Content-Type");
		return c.body(null, 204);
	});

	return router;
};
