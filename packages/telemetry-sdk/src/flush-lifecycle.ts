export interface FlushLifecycle {
	stop(): void;
}

type Timer = ReturnType<typeof setInterval>;
type FlushFn = () => Promise<void>;

export function installFlushLifecycle({
	name,
	flush,
	intervalMs,
}: {
	name: string;
	flush: FlushFn;
	intervalMs: number;
}): FlushLifecycle {
	const cleanup: Array<() => void> = [];

	const runFlush = () => {
		void flush().catch((err) => {
			console.error(`[obs-unified] ${name} flush failed:`, err);
		});
	};

	if (intervalMs > 0) {
		const timer: Timer = setInterval(runFlush, intervalMs);
		timer.unref?.();
		cleanup.push(() => clearInterval(timer));
	}

	if (typeof globalThis.addEventListener === "function") {
		globalThis.addEventListener("pagehide", runFlush);
		cleanup.push(() => globalThis.removeEventListener("pagehide", runFlush));
	}

	if (typeof process !== "undefined") {
		// `beforeExit` fires every time the event loop drains. A final flush
		// keeps the loop alive until the request settles, and if the collector
		// is down the batch is requeued and the loop drains again — forever.
		// Attempt the drain once; a failed final flush must not keep the
		// process alive.
		let finalFlushStarted = false;
		const onBeforeExit = () => {
			if (finalFlushStarted) return;
			finalFlushStarted = true;
			runFlush();
		};
		process.on("beforeExit", onBeforeExit);
		cleanup.push(() => process.off("beforeExit", onBeforeExit));

		// Do not install first signal listeners from inside the SDK: doing so
		// changes Node's default SIGTERM/SIGINT exit behavior. If the host app
		// already owns the signal lifecycle, attach a drain hook alongside it.
		for (const signal of ["SIGTERM", "SIGINT"] as const) {
			if (process.listenerCount(signal) > 0) {
				process.on(signal, runFlush);
				cleanup.push(() => process.off(signal, runFlush));
			}
		}
	}

	return {
		stop() {
			for (const fn of cleanup.splice(0)) fn();
		},
	};
}
