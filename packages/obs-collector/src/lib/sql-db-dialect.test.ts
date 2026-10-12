import { describe, expect, it } from "vitest";
import { postgresDialect, sqliteDialect } from "./sql-db";

describe("SqlDialect", () => {
	it("renders native SQLite expressions", () => {
		expect(sqliteDialect.sinceHours("?")).toBe(
			"datetime('now', '-' || ? || ' hours')",
		);
		expect(
			sqliteDialect.jsonText("attributes_json", '$."llm.cost.total_usd"'),
		).toBe(`json_extract(attributes_json, '$."llm.cost.total_usd"')`);
	});

	it("renders Postgres time windows as ISO text (timestamp columns are TEXT)", () => {
		// `received_at` / `expires_at` are TEXT on Postgres too, and Postgres
		// refuses `text >= timestamptz`, so windows must come back as text in
		// the same `YYYY-MM-DDTHH:MM:SS.mmmZ` shape `Date#toISOString` writes.
		expect(postgresDialect.sinceHours("$1")).toBe(
			`to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - ($1::text || ' hours')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
		);
		expect(postgresDialect.sinceMinutes("$2")).toBe(
			`to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - ($2::text || ' minutes')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
		);
		expect(postgresDialect.now()).toBe(
			`to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
		);
		expect(
			postgresDialect.jsonText("attributes_json", '$."llm.cost.total_usd"'),
		).toBe("(attributes_json::jsonb ->> 'llm.cost.total_usd')");
	});
});
