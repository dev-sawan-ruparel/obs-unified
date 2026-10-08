import { describe, expect, it } from "vitest";
import { TelemetryStore } from "./store";
import { MemSqlDb } from "./test-utils/mem-sql-db";

const spanRow = (overrides: Record<string, unknown>) => ({
	project_id: "default",
	trace_id: "trace-1",
	span_id: "span-1",
	parent_span_id: null,
	service_name: "api",
	scope_name: null,
	scope_version: null,
	span_name: "GET /checkout",
	span_kind: 2,
	status_code: 1,
	status_message: null,
	start_time: "2026-05-31T00:00:00.000Z",
	end_time: "2026-05-31T00:00:00.100Z",
	duration_ms: 100,
	attributes_json: "{}",
	resource_attributes_json: "{}",
	events_json: "[]",
	links_json: "[]",
	received_at: "2026-05-31T00:00:01.000Z",
	expires_at: "2026-06-01T00:00:00.000Z",
	...overrides,
});

describe("TelemetryStore overview trace aggregation", () => {
	it("selects trace ids first and fetches complete spans for selected traces", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("GROUP BY trace_id")) {
					return [
						{
							trace_id: "trace-1",
							latest_received_at: "2026-05-31T00:00:01.000Z",
							error_span_count: 1,
						},
					];
				}
				if (sql.includes("trace_id IN")) {
					return [
						spanRow({ span_id: "root", status_code: 1 }),
						spanRow({
							span_id: "child-error",
							parent_span_id: "root",
							span_name: "db.query",
							status_code: 2,
							status_message: "boom",
							duration_ms: 25,
						}),
					];
				}
				return [];
			},
		});
		const store = new TelemetryStore(db);

		const overview = await store.getOverview({
			projectId: "default",
			hours: 1,
			limit: 1,
		});

		expect(overview.traces).toHaveLength(1);
		expect(overview.traces[0]).toMatchObject({
			traceId: "trace-1",
			spanCount: 2,
			errorSpanCount: 1,
			statusCode: 2,
			statusMessage: "boom",
		});
		expect(db.calls[0].sql).toContain("GROUP BY trace_id");
		expect(db.calls[1].sql).toContain("trace_id IN");
	});
});
