import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMaintenanceScheduler, type SchedulerLogger } from "./scheduler";

const MINUTE = 60_000;

const makeLogger = () =>
	({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}) satisfies SchedulerLogger;

/** Promise whose settlement the test controls. */
const deferred = () => {
	let resolve!: () => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

describe("createMaintenanceScheduler", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs each task at its own cadence (1m / 5m / 1h)", async () => {
		const analyses = vi.fn(async () => {});
		const alerts = vi.fn(async () => {});
		const retention = vi.fn(async () => {});
		const scheduler = createMaintenanceScheduler({
			logger: makeLogger(),
			tasks: [
				{ name: "analyses", intervalMs: MINUTE, run: analyses },
				{ name: "alerts", intervalMs: 5 * MINUTE, run: alerts },
				{ name: "retention", intervalMs: 60 * MINUTE, run: retention },
			],
		});
		scheduler.start();

		expect(analyses).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(MINUTE);
		expect(analyses).toHaveBeenCalledTimes(1);
		expect(alerts).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(59 * MINUTE);
		expect(analyses).toHaveBeenCalledTimes(60);
		expect(alerts).toHaveBeenCalledTimes(12);
		expect(retention).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(60 * MINUTE);
		expect(analyses).toHaveBeenCalledTimes(120);
		expect(alerts).toHaveBeenCalledTimes(24);
		expect(retention).toHaveBeenCalledTimes(2);

		const status = scheduler.status();
		expect(status.map((s) => [s.name, s.runs, s.failures])).toEqual([
			["analyses", 120, 0],
			["alerts", 24, 0],
			["retention", 2, 0],
		]);
		await scheduler.stop();
	});

	it("honours initialDelayMs for the first tick, then the interval", async () => {
		const run = vi.fn(async () => {});
		const scheduler = createMaintenanceScheduler({
			logger: makeLogger(),
			tasks: [{ name: "t", intervalMs: MINUTE, initialDelayMs: 15_000, run }],
		});
		scheduler.start();
		await vi.advanceTimersByTimeAsync(14_999);
		expect(run).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(run).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(MINUTE - 1);
		expect(run).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(run).toHaveBeenCalledTimes(2);
		await scheduler.stop();
	});

	it("skips ticks while the previous run is still in flight", async () => {
		const logger = makeLogger();
		const gate = deferred();
		let calls = 0;
		const run = vi.fn(async () => {
			calls += 1;
			if (calls === 1) await gate.promise;
		});
		const scheduler = createMaintenanceScheduler({
			logger,
			tasks: [{ name: "slow", intervalMs: MINUTE, run }],
		});
		scheduler.start();

		// First tick starts a run that hangs; the next three ticks must skip.
		await vi.advanceTimersByTimeAsync(4 * MINUTE);
		expect(run).toHaveBeenCalledTimes(1);
		expect(scheduler.status()[0]).toMatchObject({
			running: true,
			runs: 1,
			skippedOverlaps: 3,
		});
		expect(logger.warn).toHaveBeenCalledTimes(3);
		expect(logger.warn.mock.calls[0][1]).toMatchObject({ task: "slow" });

		// Once it completes, the following tick runs again.
		gate.resolve();
		await vi.advanceTimersByTimeAsync(MINUTE);
		expect(run).toHaveBeenCalledTimes(2);
		expect(scheduler.status()[0]).toMatchObject({
			running: false,
			runs: 2,
			skippedOverlaps: 3,
		});
		await scheduler.stop();
	});

	it("logs a failing run and keeps ticking", async () => {
		const logger = makeLogger();
		let calls = 0;
		const run = vi.fn(async () => {
			calls += 1;
			if (calls === 1) throw new Error("pg connection refused");
			if (calls === 2) throw "plain string failure";
		});
		const scheduler = createMaintenanceScheduler({
			logger,
			tasks: [{ name: "flaky", intervalMs: MINUTE, run }],
		});
		scheduler.start();

		await vi.advanceTimersByTimeAsync(3 * MINUTE);
		expect(run).toHaveBeenCalledTimes(3);
		expect(logger.error).toHaveBeenCalledTimes(2);
		expect(logger.error.mock.calls[0][1]).toMatchObject({
			task: "flaky",
			error: "pg connection refused",
			failures_total: 1,
		});
		expect(logger.error.mock.calls[1][1]).toMatchObject({
			error: "plain string failure",
			failures_total: 2,
		});
		expect(scheduler.status()[0]).toMatchObject({
			runs: 3,
			failures: 2,
			lastError: undefined,
		});
		await scheduler.stop();
	});

	it("stop() prevents further ticks and waits for the in-flight run", async () => {
		const gate = deferred();
		const run = vi.fn(async () => {
			await gate.promise;
		});
		const scheduler = createMaintenanceScheduler({
			logger: makeLogger(),
			tasks: [{ name: "t", intervalMs: MINUTE, run }],
		});
		scheduler.start();
		await vi.advanceTimersByTimeAsync(MINUTE);
		expect(run).toHaveBeenCalledTimes(1);

		let settled: unknown;
		const stopping = scheduler.stop({ drainTimeoutMs: 10_000 }).then((r) => {
			settled = r;
			return r;
		});
		expect(scheduler.stopped).toBe(true);

		// Time passes (several would-be ticks, still inside the drain deadline):
		// no new run starts and stop() has not resolved yet.
		await vi.advanceTimersByTimeAsync(5_000);
		expect(run).toHaveBeenCalledTimes(1);
		expect(settled).toBeUndefined();

		gate.resolve();
		await expect(stopping).resolves.toEqual({ drained: true, inFlight: [] });
		expect(scheduler.status()[0].running).toBe(false);

		// Nothing fires after stop, even if the clock keeps running.
		await vi.advanceTimersByTimeAsync(10 * MINUTE);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("stop() gives up after the drain deadline and reports what is still running", async () => {
		const logger = makeLogger();
		const never = deferred();
		const scheduler = createMaintenanceScheduler({
			logger,
			tasks: [
				{ name: "stuck", intervalMs: MINUTE, run: () => never.promise },
				{ name: "quick", intervalMs: MINUTE, run: async () => {} },
			],
		});
		scheduler.start();
		await vi.advanceTimersByTimeAsync(MINUTE);

		const stopping = scheduler.stop({ drainTimeoutMs: 2_000 });
		await vi.advanceTimersByTimeAsync(2_000);
		await expect(stopping).resolves.toEqual({
			drained: false,
			inFlight: ["stuck"],
		});
		expect(logger.warn).toHaveBeenCalledWith(
			"[maintenance] scheduler stopped with tasks still in flight",
			expect.objectContaining({ in_flight: ["stuck"] }),
		);
	});

	it("stop() with nothing in flight resolves immediately", async () => {
		const scheduler = createMaintenanceScheduler({
			logger: makeLogger(),
			tasks: [{ name: "t", intervalMs: MINUTE, run: async () => {} }],
		});
		scheduler.start();
		await expect(scheduler.stop()).resolves.toEqual({
			drained: true,
			inFlight: [],
		});
	});

	it("start() and stop() are idempotent and start() after stop() is a no-op", async () => {
		const logger = makeLogger();
		const run = vi.fn(async () => {});
		const scheduler = createMaintenanceScheduler({
			logger,
			tasks: [{ name: "t", intervalMs: MINUTE, run }],
		});
		scheduler.start();
		scheduler.start();
		await vi.advanceTimersByTimeAsync(MINUTE);
		// Double start must not double-arm the timers.
		expect(run).toHaveBeenCalledTimes(1);

		const first = scheduler.stop();
		const second = scheduler.stop();
		expect(second).toBe(first);
		await first;

		scheduler.start();
		expect(scheduler.started).toBe(true);
		expect(scheduler.stopped).toBe(true);
		await vi.advanceTimersByTimeAsync(5 * MINUTE);
		expect(run).toHaveBeenCalledTimes(1);
		expect(logger.warn).toHaveBeenCalledWith(
			"[maintenance] start() ignored; scheduler already stopped",
		);
	});

	it("rejects duplicate names and invalid intervals up front", () => {
		expect(() =>
			createMaintenanceScheduler({
				logger: makeLogger(),
				tasks: [
					{ name: "dup", intervalMs: MINUTE, run: async () => {} },
					{ name: "dup", intervalMs: MINUTE, run: async () => {} },
				],
			}),
		).toThrow(/duplicate scheduled task name: dup/);
		expect(() =>
			createMaintenanceScheduler({
				logger: makeLogger(),
				tasks: [{ name: "zero", intervalMs: 0, run: async () => {} }],
			}),
		).toThrow(/invalid intervalMs/);
		expect(() =>
			createMaintenanceScheduler({
				logger: makeLogger(),
				tasks: [
					{
						name: "neg",
						intervalMs: MINUTE,
						initialDelayMs: -1,
						run: async () => {},
					},
				],
			}),
		).toThrow(/invalid initialDelayMs/);
	});
});
