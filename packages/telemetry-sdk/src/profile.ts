/**
 * RFC 0007 Phase 4.8 — pprof blob push helper.
 *
 * Library-agnostic: takes any gzipped pprof bytes (from `@datadog/pprof`,
 * `runtime/pprof`, `py-spy`, `pyroscope-java`, `parca-agent`, etc.) and
 * POSTs them to the collector's `/v1/profiles/pprof` endpoint with the
 * standard headers. Doesn't bundle a profiler — that's the user's
 * choice — but makes the upload step a one-liner regardless of which
 * one they pick.
 *
 * Usage with @datadog/pprof:
 *
 *   import { time } from "@datadog/pprof";
 *   import { pushProfile } from "@obs/telemetry-sdk";
 *
 *   const profile = await time.profile({ durationMillis: 60_000 });
 *   const buffer = await encode(profile); // returns gzipped pprof bytes
 *
 *   await pushProfile({
 *     collectorUrl: process.env.OBS_COLLECTOR_URL!,
 *     apiKey: process.env.OBS_INGEST_KEY!,
 *     serviceName: "my-api",
 *     profileType: "cpu",
 *     blob: buffer,
 *     traceIds: collectedTraceIds, // optional — populates profile_trace_index
 *   });
 *
 * The trace_id index drives the trace waterfall's 🔥 badge (Phase 4.6).
 * If your profiler tags samples with the active OTel trace_id, extract
 * the distinct ids before the push and pass them here.
 */

export interface PushProfileOptions {
	/** Collector URL — same shape as initObservability. */
	collectorUrl: string;
	/** Write-only ingest API key. */
	apiKey: string;
	/** Service name attribute. */
	serviceName: string;
	/** Profile type — drives storage retention + the rail's display. */
	profileType:
		| "cpu"
		| "heap"
		| "wall"
		| "block"
		| "mutex"
		| "goroutine"
		| "offcpu";
	/** Gzipped pprof bytes. */
	blob: Uint8Array | ArrayBuffer | Buffer;
	/**
	 * Distinct trace_ids referenced by samples in this blob. Populates
	 * profile_trace_index so the trace waterfall can surface the 🔥
	 * badge. Optional — when absent, the profile still ingests but
	 * per-trace lookup won't work.
	 */
	traceIds?: string[];
	/** Identifying tag for the producing agent — dashboard surfaces it. */
	agent?: string;
	/** When in the past did the profile start? Defaults to now. */
	startTimestamp?: Date;
	/** How long was the profile? Drives `duration_ms`. */
	durationMs?: number;
	/** Self-instrumentation header pass-through (see SELF_INSTRUMENTATION.md). */
	extraHeaders?: Record<string, string>;
}

export interface PushProfileResult {
	profileId: string;
	traceIdsIndexed: number;
}

const toUint8 = (
	blob: Uint8Array | ArrayBuffer | Buffer,
): Uint8Array =>
	blob instanceof Uint8Array
		? blob
		: blob instanceof ArrayBuffer
			? new Uint8Array(blob)
			: // Buffer is a Uint8Array subclass at runtime — but its type
				// is structural-only when @types/node isn't in scope.
				new Uint8Array(blob as unknown as ArrayBuffer);

/**
 * Push a single pprof blob to the collector. Returns the assigned
 * profile id. Throws on HTTP error so callers can decide whether to
 * retry or drop.
 */
export async function pushProfile(
	opts: PushProfileOptions,
): Promise<PushProfileResult> {
	const url = `${opts.collectorUrl.replace(/\/$/, "")}/v1/profiles/pprof`;
	const headers: Record<string, string> = {
		"Content-Type": "application/octet-stream",
		Authorization: `Bearer ${opts.apiKey}`,
		"x-obs-profile-type": opts.profileType,
		"x-obs-service": opts.serviceName,
		...(opts.agent ? { "x-obs-agent": opts.agent } : {}),
		...(opts.startTimestamp
			? { "x-obs-start-ts": opts.startTimestamp.toISOString() }
			: {}),
		...(opts.durationMs !== undefined
			? { "x-obs-duration-ms": String(opts.durationMs) }
			: {}),
		...(opts.traceIds && opts.traceIds.length > 0
			? { "x-obs-trace-ids": opts.traceIds.join(",") }
			: {}),
		...(opts.extraHeaders ?? {}),
	};

	const body = toUint8(opts.blob);
	const res = await fetch(url, {
		method: "POST",
		headers,
		// biome-ignore lint/suspicious/noExplicitAny: Uint8Array is a valid BodyInit at runtime
		body: body as any,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`pushProfile failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
		);
	}
	const json = (await res.json()) as {
		accepted: boolean;
		profileId: string;
		traceIdsIndexed: number;
	};
	return {
		profileId: json.profileId,
		traceIdsIndexed: json.traceIdsIndexed,
	};
}
