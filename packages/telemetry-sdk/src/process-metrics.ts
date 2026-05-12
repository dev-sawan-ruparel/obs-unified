/**
 * RFC 0005 Phase 2.5 — process CPU + memory metrics emitter.
 *
 * Wraps Node's built-in `process.cpuUsage()` / `process.memoryUsage()`
 * into a periodic sampler that emits standard OTel metrics
 * (`process.cpu.time`, `process.cpu.utilization`, `process.memory.usage`)
 * to the collector's `/v1/metrics` endpoint.
 *
 * The Health dashboard's per-service CPU tile (RFC 0005 Phase 2.6)
 * reads these series. Without this helper, services that don't already
 * ship OTel runtime instrumentation render "—" on the tile.
 *
 * Cloudflare Workers don't expose `process.cpuUsage()` so this module
 * no-ops if the API is missing; the SDK never throws, just logs a
 * one-time debug warning.
 */

import { initLogger, type LoggerConfig } from "./logger";

const SCOPE_NAME = "@obs/telemetry-sdk/process-metrics";
const SCOPE_VERSION = "1";

const METRIC_CPU_TIME = "process.cpu.time";
const METRIC_CPU_UTIL = "process.cpu.utilization";
const METRIC_MEM_RSS = "process.memory.usage";

export interface EnableProcessMetricsOptions {
	/** Collector URL — same as initObservability. */
	collectorUrl: string;
	/** Write-only ingest API key. */
	apiKey: string;
	/** Service name attached as resource attribute. */
	serviceName: string;
	/** Optional version stamped on every emission. */
	serviceVersion?: string;
	/** Sampling interval in ms. Defaults to 30 seconds. */
	intervalMs?: number;
	/**
	 * Additional headers — used by self-instrumentation paths to mark
	 * self-emitted telemetry. See SELF_INSTRUMENTATION.md.
	 */
	extraHeaders?: Record<string, string>;
}

interface CpuSample {
	/** total user+system µs since process start */
	cpuMicros: number;
	/** wall-clock ms timestamp */
	wallMs: number;
}

const sampleProcessCpu = (): CpuSample | null => {
	if (
		typeof process === "undefined" ||
		typeof process.cpuUsage !== "function"
	) {
		return null;
	}
	const usage = process.cpuUsage();
	return {
		cpuMicros: usage.user + usage.system,
		wallMs: Date.now(),
	};
};

const sampleProcessMemoryRss = (): number | null => {
	if (
		typeof process === "undefined" ||
		typeof process.memoryUsage !== "function"
	) {
		return null;
	}
	try {
		return process.memoryUsage().rss;
	} catch {
		return null;
	}
};

const nowNano = (): string => (BigInt(Date.now()) * 1_000_000n).toString();

interface OtlpResource {
	attributes: Array<{ key: string; value: { stringValue: string } }>;
}

const buildResource = (
	serviceName: string,
	serviceVersion: string | undefined,
): OtlpResource => {
	const attrs: OtlpResource["attributes"] = [
		{ key: "service.name", value: { stringValue: serviceName } },
	];
	if (serviceVersion) {
		attrs.push({
			key: "service.version",
			value: { stringValue: serviceVersion },
		});
	}
	return { attributes: attrs };
};

const buildSumPoint = (
	asDouble: number,
	timeUnixNano: string,
	startTimeUnixNano: string,
) => ({
	asDouble,
	timeUnixNano,
	startTimeUnixNano,
	attributes: [],
});

const buildGaugePoint = (asDouble: number, timeUnixNano: string) => ({
	asDouble,
	timeUnixNano,
	attributes: [],
});

interface ProcessMetricsHandle {
	stop: () => void;
}

/**
 * Start sampling `process.cpu.time`, `process.cpu.utilization`, and
 * `process.memory.usage`, pushing them to the collector at `intervalMs`
 * cadence. Returns a handle whose `stop()` clears the timer.
 *
 * Idempotent — calling twice with the same options replaces the
 * existing sampler. Returns a no-op handle in non-Node environments
 * (Workers, browsers).
 */
export function enableProcessMetrics(
	opts: EnableProcessMetricsOptions,
): ProcessMetricsHandle {
	// Re-init the logger with the same config so debug warnings have
	// somewhere to go even if the host didn't call initObservability first.
	const loggerConfig: LoggerConfig = {
		collectorUrl: opts.collectorUrl,
		authToken: opts.apiKey,
		serviceName: opts.serviceName,
		extraHeaders: opts.extraHeaders,
	};
	void initLogger(loggerConfig);

	const initial = sampleProcessCpu();
	if (initial === null) {
		// Not Node — nothing to do.
		return { stop: () => {} };
	}

	const intervalMs = opts.intervalMs ?? 30_000;
	const startTimeNano = nowNano();
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${opts.apiKey}`,
		...(opts.extraHeaders ?? {}),
	};
	const url = `${opts.collectorUrl.replace(/\/$/, "")}/v1/metrics`;

	let prev = initial;

	const tick = async () => {
		const next = sampleProcessCpu();
		if (next === null) return;
		const memRss = sampleProcessMemoryRss();

		const wallDeltaMs = Math.max(1, next.wallMs - prev.wallMs);
		const cpuDeltaMicros = Math.max(0, next.cpuMicros - prev.cpuMicros);
		const cpuDeltaSeconds = cpuDeltaMicros / 1_000_000;
		const cpuTimeCumulativeSeconds = next.cpuMicros / 1_000_000;
		// utilization = cpu_seconds / wall_seconds — fraction in [0, +∞)
		// (>1 on multi-core systems where the process used multiple cores).
		const utilization = cpuDeltaSeconds / (wallDeltaMs / 1000);
		prev = next;

		const ts = nowNano();
		const metrics: unknown[] = [
			{
				name: METRIC_CPU_TIME,
				description: "Total CPU time consumed by this process.",
				unit: "s",
				sum: {
					isMonotonic: true,
					aggregationTemporality: 2, // CUMULATIVE
					dataPoints: [
						buildSumPoint(cpuTimeCumulativeSeconds, ts, startTimeNano),
					],
				},
			},
			{
				name: METRIC_CPU_UTIL,
				description:
					"Fraction of wall time the process spent on-CPU during the interval.",
				unit: "1",
				gauge: {
					dataPoints: [buildGaugePoint(utilization, ts)],
				},
			},
		];

		if (memRss !== null) {
			metrics.push({
				name: METRIC_MEM_RSS,
				description: "Resident set size of this process.",
				unit: "By",
				gauge: {
					dataPoints: [buildGaugePoint(memRss, ts)],
				},
			});
		}

		const body = JSON.stringify({
			resourceMetrics: [
				{
					resource: buildResource(opts.serviceName, opts.serviceVersion),
					scopeMetrics: [
						{
							scope: { name: SCOPE_NAME, version: SCOPE_VERSION },
							metrics,
						},
					],
				},
			],
		});

		try {
			await fetch(url, { method: "POST", headers, body });
		} catch {
			// Swallow — process metrics are best-effort. A failed flush
			// shouldn't break the host service.
		}
	};

	const timer = setInterval(() => {
		void tick();
	}, intervalMs);
	// Don't keep the Node event loop alive on this timer alone — a
	// dev process that finishes work shouldn't hang waiting on it.
	if (typeof timer.unref === "function") timer.unref();

	return {
		stop: () => clearInterval(timer),
	};
}
