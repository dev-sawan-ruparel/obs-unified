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

	it("renders native Postgres expressions without adapter regex translation", () => {
		expect(postgresDialect.sinceHours("$1")).toBe(
			"(CURRENT_TIMESTAMP - ($1::text || ' hours')::interval)",
		);
		expect(
			postgresDialect.jsonText("attributes_json", '$."llm.cost.total_usd"'),
		).toBe("(attributes_json::jsonb ->> 'llm.cost.total_usd')");
	});
});
