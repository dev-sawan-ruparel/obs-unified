import { describe, expect, it } from "vitest";
import { TailHub } from "./tail-hub";

describe("TailHub", () => {
	it("rejects publish payloads with invalid project ids", async () => {
		const hub = new TailHub();
		const res = await hub.fetch(
			new Request("https://hub/publish", {
				method: "POST",
				body: JSON.stringify([
					{
						kind: "span",
						projectId: "../other-project",
						row: { spanId: "s1" },
						t: "2026-05-31T00:00:00.000Z",
					},
				]),
			}),
		);

		expect(res.status).toBe(400);
	});

	it("rejects subscriptions with invalid project ids", async () => {
		const hub = new TailHub();
		const res = await hub.fetch(
			new Request("https://hub/subscribe?projectId=../other-project"),
		);

		expect(res.status).toBe(400);
	});
});
