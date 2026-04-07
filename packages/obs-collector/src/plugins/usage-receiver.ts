/** Union: A's JSON error handling, event limit, env-based retention. P/D's dynamic CORS. */

import type {
	UsageEventInput,
	UsageEventPayload,
	UsageEventRecord,
} from "@obs/types";
import {
	DEFAULT_WINDOW_HOURS,
	getConfiguredRetentionHours,
} from "@obs/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import { retentionExpiry } from "../lib/otlp";

const sanitizeIsoTimestamp = (value?: string): string => {
	if (!value) return new Date().toISOString();
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime())
		? new Date().toISOString()
		: parsed.toISOString();
};

const toUsageRecord = (
	input: UsageEventInput,
	userAgent: string | null,
	country: string | null,
	receivedAt: Date,
	retentionHours?: number,
): UsageEventRecord => ({
	eventId: crypto.randomUUID(),
	sessionId: input.sessionId,
	visitorId: input.visitorId,
	eventType: input.type,
	eventName: input.name,
	pagePath: input.path || null,
	pageTitle: input.title || null,
	referrer: input.referrer || null,
	severity: input.severity || "info",
	source: "web",
	contextJson: JSON.stringify(input.context || {}),
	propertiesJson: JSON.stringify(input.properties || {}),
	userAgent,
	occurredAt: sanitizeIsoTimestamp(input.occurredAt),
	receivedAt: receivedAt.toISOString(),
	expiresAt: retentionExpiry(receivedAt, retentionHours),
	country,
	browser: null,
	os: null,
	deviceType: null,
	isBot: false,
	utmSource: null,
	utmMedium: null,
	utmCampaign: null,
});

export const usageReceiverPlugin: CollectorPlugin = {
	name: "usage-receiver",
	register(app, runtime) {
		app.options("/v1/usage", (c) => {
			c.header("Access-Control-Allow-Origin", c.req.header("Origin") || "*");
			c.header("Access-Control-Allow-Methods", "POST,OPTIONS");
			c.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
			return c.body(null, 204);
		});

		app.post("/v1/usage", async (c) => {
			let payload: UsageEventPayload;
			try {
				payload = await c.req.json<UsageEventPayload>();
			} catch {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			const rawEvents = payload.events || [];
			if (rawEvents.length > 200) {
				return c.json(
					{ error: `Too many events: ${rawEvents.length} (max 200)` },
					413,
				);
			}
			const validInputs = rawEvents.filter((event): event is UsageEventInput =>
				Boolean(
					event?.type && event?.name && event?.sessionId && event?.visitorId,
				),
			);

			const receivedAt = new Date();
			const retentionHours = getConfiguredRetentionHours(c.env.RETENTION_HOURS);
			const country = c.req.header("X-Client-Country") || null;
			const records = validInputs.map((event) =>
				toUsageRecord(
					event,
					c.req.header("User-Agent") || null,
					country,
					receivedAt,
					retentionHours,
				),
			);

			const processed = await runtime.runUsageEventProcessors(
				records,
				runtime.createRouteContext(c.env, c),
			);
			const store = runtime.createUsageStore(c.env);
			const result = await store.ingest(processed);

			c.header("Access-Control-Allow-Origin", c.req.header("Origin") || "*");

			return c.json({
				success: true,
				inserted: result.inserted,
				sessionCount: result.sessionCount,
				acceptedWindowHours: DEFAULT_WINDOW_HOURS,
			});
		});
	},
};
