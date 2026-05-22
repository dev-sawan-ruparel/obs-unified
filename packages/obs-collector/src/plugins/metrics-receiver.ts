/** OTLP/HTTP metrics receiver. Accepts JSON or protobuf, with gzip. */

import type { CollectorPlugin } from "../framework/collector";
import { MetricsStore } from "../lib/metrics-store";
import { sqlDbFor } from "../lib/sql-db";
import {
	decodeMetricsRequest,
	OtlpDecodeError,
	readOtlpBody,
} from "../otlp/decode";
import { metricsResponse, otlpRetryableError } from "../otlp/response";
import { getProjectId } from "./_context";

const MAX_POINTS_PER_REQUEST = 2000;

export const metricsReceiverPlugin: CollectorPlugin = {
	name: "metrics-http-receiver",
	register(app, runtime) {
		app.post("/v1/metrics", async (c) => {
			const projectId = getProjectId(c);

			let body;
			try {
				body = await readOtlpBody(c);
			} catch (err) {
				if (err instanceof OtlpDecodeError) {
					return c.json({ error: err.message }, err.status);
				}
				throw err;
			}

			let points;
			try {
				points = decodeMetricsRequest(body);
			} catch (err) {
				if (err instanceof OtlpDecodeError) {
					return c.json({ error: err.message }, err.status);
				}
				throw err;
			}

			let rejected = 0;
			if (points.length > MAX_POINTS_PER_REQUEST) {
				rejected = points.length - MAX_POINTS_PER_REQUEST;
				points = points.slice(0, MAX_POINTS_PER_REQUEST);
			}

			const retentionHours = parseInt(c.env.RETENTION_HOURS || "72", 10);
			const now = new Date();
			const receivedAt = now.toISOString();
			const expiresAt = new Date(
				now.getTime() + retentionHours * 60 * 60 * 1000,
			).toISOString();

			const store = new MetricsStore(sqlDbFor(c.env));
			try {
				await runtime.withChildSpan("metrics.ingest", async (span) => {
					span.setAttribute(
						"metrics.points_received",
						points.length + rejected,
					);
					span.setAttribute("metrics.points_rejected", rejected);
					span.setAttribute("metrics.points_inserted", points.length);
					span.setAttribute("project.id", projectId);
					await store.ingestBatch({
						projectId,
						points,
						receivedAt,
						expiresAt,
					});
				});
			} catch (err) {
				runtime.logger.error("[/v1/metrics] storage error", {
					project_id: projectId,
					error: err instanceof Error ? err.message : String(err),
				});
				return otlpRetryableError(c, 503, "Storage temporarily unavailable");
			}

			if (rejected > 0) {
				return metricsResponse(c, body.wireFormat, {
					rejected,
					errorMessage: `Batch exceeded ${MAX_POINTS_PER_REQUEST}-point cap; ${rejected} point(s) dropped`,
				});
			}
			return metricsResponse(c, body.wireFormat);
		});
	},
};
