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
 *   import { pushProfile } from "@obs-unified/telemetry-sdk";
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

// ── startProfiler — auto-loop wrapper ────────────────────────────────

/**
 * A profiler-agnostic capture function. Returns the gzipped pprof bytes
 * for one sampling window plus the distinct trace_ids encountered (so
 * the loop can pass them to `pushProfile`'s `traceIds` for the index;
 * the collector now also extracts these at ingest, but supplying them
 * here saves the worker a parse).
 */
export interface ProfileCapture {
	blob: Uint8Array | ArrayBuffer | Buffer;
	traceIds?: string[];
	startTimestamp?: Date;
	durationMs?: number;
}

export interface StartProfilerOptions {
	collectorUrl: string;
	apiKey: string;
	serviceName: string;
	profileType: PushProfileOptions["profileType"];
	/** ms between sampling windows. Default 60_000. */
	intervalMs?: number;
	/** "datadog-pprof", "go-runtime-pprof", "pyroscope-java", etc. */
	agent?: string;
	/** Self-instrumentation passthrough. */
	extraHeaders?: Record<string, string>;
	/**
	 * Capture one window of pprof bytes. RFC 0007 deliberately does NOT
	 * bundle a profiler — supply the wrapper for whichever library you
	 * picked (`@datadog/pprof` for Node, `pprof-rs` for Rust via Wasm,
	 * etc.). See docs/howto/profiling.md for per-language recipes.
	 */
	capture: () => Promise<ProfileCapture>;
	/** Optional callback for push errors — defaults to console.warn. */
	onError?: (err: unknown) => void;
}

export interface ProfilerHandle {
	stop: () => void;
}

/**
 * Auto-loop helper that captures + pushes profiles on an interval. Wraps
 * `pushProfile` and owns the timer; the actual sampling library is
 * injected via `capture`. Returns a handle whose `stop()` halts the
 * loop (any in-flight push completes first).
 *
 *   import { time, encode } from "@datadog/pprof";
 *   import { startProfiler } from "@obs-unified/telemetry-sdk";
 *
 *   const handle = startProfiler({
 *     collectorUrl: process.env.OBS_COLLECTOR_URL!,
 *     apiKey: process.env.OBS_INGEST_KEY!,
 *     serviceName: "my-api",
 *     profileType: "cpu",
 *     intervalMs: 60_000,
 *     agent: "datadog-pprof",
 *     capture: async () => {
 *       const profile = await time.profile({ durationMillis: 60_000 });
 *       return { blob: await encode(profile), durationMs: 60_000 };
 *     },
 *   });
 *
 * Idempotent stop. Safe to call in non-Node environments — the timer
 * unrefs so a process finishing other work doesn't hang.
 */
export function startProfiler(opts: StartProfilerOptions): ProfilerHandle {
	const intervalMs = opts.intervalMs ?? 60_000;
	const onError =
		opts.onError ??
		((err: unknown) => {
			// Default surface — a profiling failure shouldn't bubble into
			// the host service's error path.
			console.warn("[obs/telemetry-sdk] startProfiler push failed", err);
		});

	let stopped = false;
	let inFlight: Promise<unknown> | null = null;

	const tick = async () => {
		if (stopped) return;
		try {
			const capture = await opts.capture();
			if (stopped) return;
			inFlight = pushProfile({
				collectorUrl: opts.collectorUrl,
				apiKey: opts.apiKey,
				serviceName: opts.serviceName,
				profileType: opts.profileType,
				blob: capture.blob,
				traceIds: capture.traceIds,
				agent: opts.agent,
				startTimestamp: capture.startTimestamp,
				durationMs: capture.durationMs,
				extraHeaders: opts.extraHeaders,
			});
			await inFlight;
		} catch (err) {
			onError(err);
		} finally {
			inFlight = null;
		}
	};

	// Fire-and-forget initial tick; subsequent ticks fire on the timer.
	void tick();
	const timer = setInterval(() => {
		void tick();
	}, intervalMs);
	if (typeof timer.unref === "function") timer.unref();

	return {
		stop: () => {
			stopped = true;
			clearInterval(timer);
			// Caller may want to await the in-flight push; we expose it
			// via a then-able since stop() itself is sync.
			void inFlight;
		},
	};
}

const toUint8 = (blob: Uint8Array | ArrayBuffer | Buffer): Uint8Array =>
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
