import { describe, expect, it } from "vitest";
import { purgeSecondaryRows } from "./housekeeping";
import { createMigratedSqliteDb } from "./test-utils/node-sqlite-db";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * HOUR).toISOString();

describe("purgeSecondaryRows", () => {
	it("removes only rows no API window or ingest path can still reach", async () => {
		const db = createMigratedSqliteDb();
		const raw = db.raw;
		raw.exec(`
			INSERT INTO projects (id, name, slug, created_at) VALUES ('alpha', 'A', 'a', '${iso(1000)}');
			INSERT INTO alert_rules (id, project_id, name, signal, query_json, threshold, window_mins, comparison, channels_json, enabled, created_at, updated_at)
			VALUES ('r1', 'alpha', 'r', 'spans', '{}', 1, 5, '>', '[]', 1, '${iso(1000)}', '${iso(1000)}');
		`);
		const ev = raw.prepare(
			`INSERT INTO alert_evaluations (id, rule_id, project_id, evaluated_at, value, state, notified) VALUES (?, 'r1', 'alpha', ?, 1, 'ok', 0)`,
		);
		ev.run("old", iso(721));
		ev.run("edge", iso(719));
		const ask = raw.prepare(
			`INSERT INTO ask_evidence_events (project_id, analysis_id, asked_at) VALUES ('alpha', 'x', ?)`,
		);
		ask.run(NOW - 31 * 24 * HOUR);
		ask.run(NOW - 29 * 24 * HOUR);
		const series = raw.prepare(
			`INSERT INTO metric_series (id, project_id, name, type, identity, created_at) VALUES (?, 'alpha', 'm', 'gauge', ?, ?)`,
		);
		series.run("orphan-old", "i1", iso(100)); // no points, older than window
		series.run("orphan-new", "i2", iso(1)); // no points but just created
		series.run("live", "i3", iso(100)); // old but still has a point
		raw
			.prepare(
				`INSERT INTO metric_point (id, series_id, project_id, ts_ns, received_at, expires_at) VALUES ('p1', 'live', 'alpha', '1', ?, ?)`,
			)
			.run(iso(1), iso(-1));
		const ref = raw.prepare(
			`INSERT INTO evidence_retrieval_refs (ref_id, project_id, kind, anchor_kind, anchor_id, source, expires_at) VALUES (?, 'alpha', 'logs', 'trace', 't', 'test', ?)`,
		);
		ref.run("expired", iso(1));
		ref.run("fresh", iso(-1));
		ref.run("no-expiry", null);
		const exp = raw.prepare(
			`INSERT INTO evidence_ref_expansions (id, ref_id, project_id, kind, operation, result_status) VALUES (?, ?, 'alpha', 'logs', 'expand', 'ok')`,
		);
		exp.run("e1", "expired");
		exp.run("e2", "fresh");

		const summary = await purgeSecondaryRows(db, {
			retentionHours: 72,
			now: () => NOW,
		});
		expect(summary).toEqual({
			alert_evaluations: 1,
			ask_evidence_events: 1,
			metric_series: 1,
			evidence_refs: 1,
			evidence_ref_expansions: 1,
		});
		const ids = (sql: string) =>
			(raw.prepare(sql).all() as Array<{ id: string }>).map((r) => r.id).sort();
		expect(ids("SELECT id FROM alert_evaluations")).toEqual(["edge"]);
		expect(ids("SELECT id FROM metric_series")).toEqual(["live", "orphan-new"]);
		expect(ids("SELECT ref_id AS id FROM evidence_retrieval_refs")).toEqual([
			"fresh",
			"no-expiry",
		]);
		expect(ids("SELECT id FROM evidence_ref_expansions")).toEqual(["e2"]);
		db.close();
	});
});
