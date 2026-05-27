/** OTLP/HTTP trace receiver. Accepts JSON or protobuf, with gzip. */

import { getConfiguredRetentionHours } from "@obs-unified/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import { toStoredSpans } from "../lib/otlp";
import { publishTail, spanToTailEvent } from "../lib/tail-publisher";
import {
	decodeTraceRequest,
	OtlpDecodeError,
	type ReadBodyResult,
	readOtlpBody,
} from "../otlp/decode";
import { otlpRetryableError, traceResponse } from "../otlp/response";
import { getProjectId } from "./_context";

const MAX_SPANS_PER_REQUEST = 500;

export const otlpReceiverPlugin: CollectorPlugin = {
	name: "otlp-http-receiver",
	register(app, runtime) {
		app.post("/v1/traces", async (c) => {
			const projectId = getProjectId(c);
			const routeContext = runtime.createRouteContext(c.env, c);

			let body: ReadBodyResult;
			try {
				body = await readOtlpBody(c);
			} catch (err) {
				if (err instanceof OtlpDecodeError) {
					return c.json({ error: err.message }, err.status);
				}
				throw err;
			}

			let payload: ReturnType<typeof decodeTraceRequest>;
			try {
				payload = decodeTraceRequest(body);
			} catch (err) {
				if (err instanceof OtlpDecodeError) {
					return c.json({ error: err.message }, err.status);
				}
				throw err;
			}

			// Count spans and truncate to cap, tracking rejected excess for the
			// partial_success envelope. We rebuild a trimmed payload rather than
			// touching the rest of the pipeline.
			let total = 0;
			let rejected = 0;
			const trimmedResourceSpans = [];
			for (const rs of payload.resourceSpans ?? []) {
				const scopeSpans = [];
				for (const ss of rs.scopeSpans ?? []) {
					const spans = [];
					for (const s of ss.spans ?? []) {
						if (total >= MAX_SPANS_PER_REQUEST) {
							rejected++;
						} else {
							spans.push(s);
							total++;
						}
					}
					scopeSpans.push({ ...ss, spans });
				}
				trimmedResourceSpans.push({ ...rs, scopeSpans });
			}

			const parsedSpans = toStoredSpans(
				{ resourceSpans: trimmedResourceSpans },
				projectId,
				routeContext.now,
				getConfiguredRetentionHours(c.env.RETENTION_HOURS),
			);
			// `toStoredSpans` silently drops spans with invalid trace/span IDs
			// (length mismatch, non-hex). Surface those to the caller via
			// partial_success rather than making them disappear.
			const malformed = total - parsedSpans.length;
			const totalRejected = rejected + malformed;

			const spans = await runtime.runSpanProcessors(parsedSpans, routeContext);
			const store = runtime.createStore(c.env);
			try {
				await runtime.withChildSpan("traces.ingest", async (span) => {
					span.setAttribute("traces.spans_received", total);
					span.setAttribute("traces.spans_rejected", totalRejected);
					span.setAttribute("traces.spans_inserted", spans.length);
					span.setAttribute("project.id", projectId);
					await store.ingest(spans);
				});
			} catch (err) {
				runtime.logger.error("[/v1/traces] storage error", {
					project_id: projectId,
					error: err instanceof Error ? err.message : String(err),
				});
				return otlpRetryableError(c, 503, "Storage temporarily unavailable");
			}

			if (spans.length > 0 && c.env.TAIL_HUB) {
				const events = spans.map(spanToTailEvent);
				c.executionCtx.waitUntil(publishTail(c.env, events));
			}

			if (totalRejected > 0) {
				const parts: string[] = [];
				if (rejected > 0)
					parts.push(
						`${rejected} span(s) dropped over ${MAX_SPANS_PER_REQUEST}-span cap`,
					);
				if (malformed > 0)
					parts.push(
						`${malformed} span(s) rejected (invalid trace_id or span_id)`,
					);
				return traceResponse(c, body.wireFormat, {
					rejected: totalRejected,
					errorMessage: parts.join("; "),
				});
			}
			return traceResponse(c, body.wireFormat);
		});
	},
};
