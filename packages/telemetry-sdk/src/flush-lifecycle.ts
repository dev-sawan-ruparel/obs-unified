export interface FlushLifecycle {
	stop(): void;
}

/**
 * Snapshot of an exporter's buffer for the final `beforeExit` drain.
 * `revision` must increase only when a genuinely new item is enqueued —
 * never when a failed batch is put back — so the drain can tell new
 * telemetry from a requeue even when the buffer is capped and an enqueue
 * evicts an older item without changing `count`.
 */
export interface PendingSnapshot {
	count: number;
	revision: number;
}

type Timer = ReturnType<typeof setInterval>;
type FlushFn = () => Promise<void>;

export function installFlushLifecycle({
	name,
	flush,
	intervalMs,
	pending,
}: {
	name: string;
	flush: FlushFn;
	intervalMs: number;
	/**
	 * Buffer snapshot (see `PendingSnapshot`). Lets the `beforeExit` hook
	 * tell "new work arrived" from "the last attempt requeued everything",
	 * so a later event-loop drain still flushes without looping forever
	 * against a dead collector. Without it the final flush runs once.
	 */
	pending?: () => PendingSnapshot;
}): FlushLifecycle {
	const cleanup: Array<() => void> = [];

	const runFlush = (): Promise<void> =>
		flush().catch((err) => {
			console.error(`[obs-unified] ${name} flush failed:`, err);
		});

	if (intervalMs > 0) {
		const timer: Timer = setInterval(runFlush, intervalMs);
		timer.unref?.();
		cleanup.push(() => clearInterval(timer));
	}

	if (typeof globalThis.addEventListener === "function") {
		const onPageHide = () => void runFlush();
		globalThis.addEventListener("pagehide", onPageHide);
		cleanup.push(() => globalThis.removeEventListener("pagehide", onPageHide));
	}

	if (typeof process !== "undefined") {
		// `beforeExit` fires every time the event loop drains. A final flush
		// keeps the loop alive until the request settles, and if the collector
		// is down the batch is requeued and the loop drains again — forever.
		// Flush on a drain only when something was enqueued since the revision
		// the previous attempt started from: a requeued batch does not move the
		// revision (stop), while a new item does — even when a capped buffer
		// evicts an older entry and the length stays the same, and even when
		// it arrives while that attempt is still in flight (the revision is
		// taken at the start, so later arrivals are newer than it). Without a
		// `pending` probe, fall back to a single attempt.
		let inFlight = false;
		let attempted = false;
		let attemptedRevision = Number.NEGATIVE_INFINITY;
		const onBeforeExit = () => {
			if (inFlight) return;
			if (pending) {
				const { count, revision } = pending();
				if (count === 0 || revision <= attemptedRevision) return;
				attemptedRevision = revision;
			} else if (attempted) {
				return;
			}
			attempted = true;
			inFlight = true;
			void runFlush().finally(() => {
				inFlight = false;
			});
		};
		process.on("beforeExit", onBeforeExit);
		cleanup.push(() => process.off("beforeExit", onBeforeExit));

		// Do not install first signal listeners from inside the SDK: doing so
		// changes Node's default SIGTERM/SIGINT exit behavior. If the host app
		// already owns the signal lifecycle, attach a drain hook alongside it.
		const onSignal = () => void runFlush();
		for (const signal of ["SIGTERM", "SIGINT"] as const) {
			if (process.listenerCount(signal) > 0) {
				process.on(signal, onSignal);
				cleanup.push(() => process.off(signal, onSignal));
			}
		}
	}

	return {
		stop() {
			for (const fn of cleanup.splice(0)) fn();
		},
	};
}
