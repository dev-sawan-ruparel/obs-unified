import type { StoredSpan } from "@obsunified/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearOntologyUpsertCache,
	extractSpanLineageAndTopology,
	upsertOntologyFromSpans,
} from "./autosre-ontology";
import type { SqlDb } from "./sql-db";

const dbSpan = (i: number, environment = "prod"): StoredSpan =>
	({
		projectId: "p",
		traceId: `t${i}`,
		spanId: `s${i}`,
		environment,
		startTime: "2026-10-15T00:00:00.000Z",
		receivedAt: "2026-10-15T00:00:00.000Z",
		attributesJson: JSON.stringify({
			"db.system": "postgresql",
			"db.name": `db${i}`,
			"server.address": "pg.internal",
			"server.port": 5432,
		}),
		resourceAttributesJson: "{}",
	}) as unknown as StoredSpan;

const fakeDb = (batch: SqlDb["batch"]): SqlDb => {
	const stmt = { bind: () => stmt };
	return { prepare: () => stmt, batch } as unknown as SqlDb;
};

describe("ontology env normalization", () => {
	afterEach(() => clearOntologyUpsertCache());

	it("maps production-tagged spans to the prod environment", () => {
		const span = {
			...dbSpan(1, ""),
			environment: undefined,
			resourceAttributesJson: JSON.stringify({
				"deployment.environment.name": "Production",
			}),
		} as unknown as StoredSpan;
		expect(extractSpanLineageAndTopology(span).environment).toBe("prod");
	});
});

describe("NODE_UPSERT_CACHE", () => {
	afterEach(() => clearOntologyUpsertCache());

	it("does not remember keys when the batch fails", async () => {
		const failing = vi.fn(async () => {
			throw new Error("boom");
		});
		await expect(
			upsertOntologyFromSpans(fakeDb(failing as never), [dbSpan(1)]),
		).rejects.toThrow("boom");
		const ok = vi.fn(async () => []);
		await upsertOntologyFromSpans(fakeDb(ok as never), [dbSpan(1)]);
		expect(ok).toHaveBeenCalledTimes(1);
		// Now cached: a third call writes nothing.
		const again = vi.fn(async () => []);
		await upsertOntologyFromSpans(fakeDb(again as never), [dbSpan(1)]);
		expect(again).not.toHaveBeenCalled();
	});

	it("caps the cache and evicts the oldest entries", async () => {
		const spans = Array.from({ length: 5_002 }, (_, i) => dbSpan(i));
		const batch = vi.fn(async () => []);
		await upsertOntologyFromSpans(fakeDb(batch as never), spans);
		// Oldest keys were evicted so they are written again; newest stay cached.
		const second = vi.fn(async () => []);
		await upsertOntologyFromSpans(fakeDb(second as never), [dbSpan(0)]);
		expect(second).toHaveBeenCalledTimes(1);
		const third = vi.fn(async () => []);
		await upsertOntologyFromSpans(fakeDb(third as never), [dbSpan(5_001)]);
		expect(third).not.toHaveBeenCalled();
	});
});
