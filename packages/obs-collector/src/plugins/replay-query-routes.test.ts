import { describe, expect, it } from "vitest";
import { fetchReplayChunks } from "./replay-query-routes";

describe("fetchReplayChunks", () => {
	it("fetches replay chunk objects with bounded concurrency and preserves order", async () => {
		let active = 0;
		let maxActive = 0;
		const bucket = {
			async get(key: string) {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active -= 1;
				return {
					async json<T>() {
						return [{ key }] as T;
					},
				};
			},
		};

		const events = await fetchReplayChunks(
			bucket,
			Array.from({ length: 6 }, (_, i) => ({ key: `chunk-${i}` })),
			2,
		);

		expect(maxActive).toBeLessThanOrEqual(2);
		expect(events.map((event) => event.key)).toEqual([
			"chunk-0",
			"chunk-1",
			"chunk-2",
			"chunk-3",
			"chunk-4",
			"chunk-5",
		]);
	});
});
