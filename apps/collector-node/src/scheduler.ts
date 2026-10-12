/**
 * In-process interval scheduler for the standalone Node collector.
 *
 * The Cloudflare Worker gets its background maintenance from Cron Triggers
 * (see `apps/collector/wrangler.toml`). A long-running Node process has no
 * equivalent, so this module provides the host-side half: fixed-cadence
 * ticks per task with the guarantees a cron runner is expected to give:
 *
 *   - **No overlapping runs.** A tick that fires while the previous run of
 *     the same task is still in flight is skipped (and counted) rather than
 *     started. Slow retention sweeps never pile up.
 *   - **Failures don't stop the clock.** A rejected run is logged with the
 *     task name and the next tick fires as normal.
 *   - **Clean shutdown.** `stop()` cancels every timer so no new run starts,
 *     then waits for in-flight runs up to a deadline so the host can close
 *     its DB pool safely afterwards.
 *
 * The scheduler is deliberately independent of `@obsunified/collector`;
 * `maintenance.ts` wires the collector's tasks into it.
 */

export interface SchedulerLogger {
	info(message: string, attributes?: Record<string, unknown>): void;
	warn(message: string, attributes?: Record<string, unknown>): void;
	error(message: string, attributes?: Record<string, unknown>): void;
}

export interface ScheduledTask {
	/** Stable identifier used in logs and `status()`. Must be unique. */
	name: string;
	/** Fixed cadence between tick starts, in milliseconds. */
	intervalMs: number;
	/**
	 * Delay before the first tick. Defaults to `intervalMs`, i.e. the first
	 * run happens one full interval after `start()`.
	 */
	initialDelayMs?: number;
	/** The work. Rejections are logged and counted; they never propagate. */
	run: () => Promise<unknown>;
}

export interface ScheduledTaskStatus {
	name: string;
	intervalMs: number;
	/** `true` while a run is in flight. */
	running: boolean;
	/** Runs started (including failed ones). */
	runs: number;
	/** Runs that rejected. */
	failures: number;
	/** Ticks skipped because the previous run was still in flight. */
	skippedOverlaps: number;
	lastStartedAt?: number;
	lastFinishedAt?: number;
	lastDurationMs?: number;
	lastError?: string;
}

export interface StopResult {
	/** `true` when every in-flight run finished before the deadline. */
	drained: boolean;
	/** Names of tasks still running when `stop()` resolved. */
	inFlight: string[];
}

export interface MaintenanceScheduler {
	/** Arm the timers. Idempotent; a no-op after `stop()`. */
	start(): void;
	/**
	 * Cancel all timers and wait for in-flight runs. Idempotent — repeated
	 * calls return the same promise. Default drain deadline is 10s.
	 */
	stop(options?: { drainTimeoutMs?: number }): Promise<StopResult>;
	status(): ScheduledTaskStatus[];
	readonly started: boolean;
	readonly stopped: boolean;
}

export interface MaintenanceSchedulerOptions {
	tasks: ScheduledTask[];
	logger?: SchedulerLogger;
	/** Clock override for tests. Defaults to `Date.now`. */
	now?: () => number;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

interface TaskState {
	task: ScheduledTask;
	timer?: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;
	inFlight?: Promise<void>;
	status: ScheduledTaskStatus;
}

const consoleSchedulerLogger: SchedulerLogger = {
	info: (m, a) => console.log(m, a ?? ""),
	warn: (m, a) => console.warn(m, a ?? ""),
	error: (m, a) => console.error(m, a ?? ""),
};

const unref = (timer: TaskState["timer"]) => {
	// Don't let a maintenance timer alone keep the process alive — the HTTP
	// server is what holds the event loop open. Guarded because fake timers
	// (and some runtimes) don't implement `unref`.
	const t = timer as { unref?: () => void } | undefined;
	if (t && typeof t.unref === "function") t.unref();
};

const errorMessage = (err: unknown): string =>
	err instanceof Error ? err.message : String(err);

export function createMaintenanceScheduler(
	options: MaintenanceSchedulerOptions,
): MaintenanceScheduler {
	const logger = options.logger ?? consoleSchedulerLogger;
	const now = options.now ?? Date.now;

	const states: TaskState[] = [];
	const seen = new Set<string>();
	for (const task of options.tasks) {
		if (!task.name) throw new Error("scheduled task requires a name");
		if (seen.has(task.name)) {
			throw new Error(`duplicate scheduled task name: ${task.name}`);
		}
		seen.add(task.name);
		if (!Number.isFinite(task.intervalMs) || task.intervalMs <= 0) {
			throw new Error(
				`scheduled task ${task.name} has invalid intervalMs: ${task.intervalMs}`,
			);
		}
		if (
			task.initialDelayMs !== undefined &&
			(!Number.isFinite(task.initialDelayMs) || task.initialDelayMs < 0)
		) {
			throw new Error(
				`scheduled task ${task.name} has invalid initialDelayMs: ${task.initialDelayMs}`,
			);
		}
		states.push({
			task,
			status: {
				name: task.name,
				intervalMs: task.intervalMs,
				running: false,
				runs: 0,
				failures: 0,
				skippedOverlaps: 0,
			},
		});
	}

	let started = false;
	let stopping = false;
	let stopPromise: Promise<StopResult> | undefined;

	const fire = (state: TaskState): void => {
		if (stopping) return;
		const { task, status } = state;
		if (state.inFlight) {
			status.skippedOverlaps += 1;
			logger.warn("[maintenance] skipped tick; previous run still in flight", {
				task: task.name,
				running_for_ms:
					status.lastStartedAt !== undefined ? now() - status.lastStartedAt : 0,
				skipped_total: status.skippedOverlaps,
			});
			return;
		}

		const startedAt = now();
		status.running = true;
		status.runs += 1;
		status.lastStartedAt = startedAt;

		const execution = (async () => {
			try {
				await task.run();
				status.lastError = undefined;
			} catch (err) {
				status.failures += 1;
				status.lastError = errorMessage(err);
				logger.error("[maintenance] task failed", {
					task: task.name,
					error: status.lastError,
					failures_total: status.failures,
				});
			} finally {
				const finishedAt = now();
				status.running = false;
				status.lastFinishedAt = finishedAt;
				status.lastDurationMs = finishedAt - startedAt;
				state.inFlight = undefined;
			}
		})();
		state.inFlight = execution;
	};

	const arm = (state: TaskState): void => {
		const { task } = state;
		const initialDelay = task.initialDelayMs ?? task.intervalMs;
		state.timer = setTimeout(() => {
			if (stopping) return;
			fire(state);
			state.timer = setInterval(() => fire(state), task.intervalMs);
			unref(state.timer);
		}, initialDelay);
		unref(state.timer);
	};

	const clearTimers = (): void => {
		for (const state of states) {
			if (state.timer !== undefined) {
				// A single clearTimeout handles both timeout and interval handles
				// in Node, but be explicit so the intent reads clearly.
				clearTimeout(state.timer as ReturnType<typeof setTimeout>);
				clearInterval(state.timer as ReturnType<typeof setInterval>);
				state.timer = undefined;
			}
		}
	};

	const waitForDrain = async (drainTimeoutMs: number): Promise<StopResult> => {
		const pending = states.filter((s) => s.inFlight);
		if (pending.length === 0) return { drained: true, inFlight: [] };

		let deadline: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<"timeout">((resolve) => {
			deadline = setTimeout(() => resolve("timeout"), drainTimeoutMs);
			unref(deadline);
		});
		const settled = Promise.all(
			pending.map((s) => s.inFlight ?? Promise.resolve()),
		).then(() => "drained" as const);

		const outcome = await Promise.race([settled, timedOut]);
		if (deadline !== undefined) clearTimeout(deadline);

		const inFlight = states.filter((s) => s.inFlight).map((s) => s.task.name);
		return {
			drained: outcome === "drained" && inFlight.length === 0,
			inFlight,
		};
	};

	return {
		get started() {
			return started;
		},
		get stopped() {
			return stopping;
		},
		start() {
			if (stopping) {
				logger.warn("[maintenance] start() ignored; scheduler already stopped");
				return;
			}
			if (started) return;
			started = true;
			for (const state of states) arm(state);
			logger.info("[maintenance] scheduler started", {
				tasks: states.map((s) => ({
					name: s.task.name,
					interval_ms: s.task.intervalMs,
					initial_delay_ms: s.task.initialDelayMs ?? s.task.intervalMs,
				})),
			});
		},
		stop(stopOptions) {
			if (stopPromise) return stopPromise;
			stopping = true;
			clearTimers();
			const drainTimeoutMs =
				stopOptions?.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
			stopPromise = waitForDrain(drainTimeoutMs).then((result) => {
				if (result.drained) {
					logger.info("[maintenance] scheduler stopped", {
						tasks: states.map((s) => ({
							name: s.task.name,
							runs: s.status.runs,
							failures: s.status.failures,
							skipped_overlaps: s.status.skippedOverlaps,
						})),
					});
				} else {
					logger.warn(
						"[maintenance] scheduler stopped with tasks still in flight",
						{ in_flight: result.inFlight, drain_timeout_ms: drainTimeoutMs },
					);
				}
				return result;
			});
			return stopPromise;
		},
		status() {
			return states.map((s) => ({ ...s.status }));
		},
	};
}
