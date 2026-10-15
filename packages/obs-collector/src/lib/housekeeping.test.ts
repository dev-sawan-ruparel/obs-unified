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
			ontology_edges: 0,
			ontology_nodes: 0,
			change_events: 0,
			incident_investigations: 0,
			remediation_proposals: 0,
			investigation_findings: 0,
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

	it("enforces RFC 0013 AutoSRE retention windows while preserving counterfactual_verified and operationally_corroborated findings", async () => {
		const db = createMigratedSqliteDb();
		const raw = db.raw;
		raw.exec(`
			INSERT INTO projects (id, name, slug, created_at) VALUES ('alpha', 'A', 'a', '${iso(3000)}');
		`);
		// Ontology edges/nodes (30d = 720h)
		raw
			.prepare(
				`INSERT INTO ontology_nodes (id, project_id, environment, kind, name, first_seen_at, last_seen_at) VALUES (?, 'alpha', 'prod', 'service', ?, ?, ?)`,
			)
			.run("n-old", "old-svc", iso(800), iso(750));
		raw
			.prepare(
				`INSERT INTO ontology_nodes (id, project_id, environment, kind, name, first_seen_at, last_seen_at) VALUES (?, 'alpha', 'prod', 'service', ?, ?, ?)`,
			)
			.run("n-fresh", "fresh-svc", iso(100), iso(10));
		raw
			.prepare(
				`INSERT INTO ontology_edges (id, project_id, environment, source_node_id, predicate, target_node_id, relationship_certainty, first_seen_at, last_seen_at) VALUES (?, 'alpha', 'prod', 'n-old', 'calls', 'n-fresh', 'exact', ?, ?)`,
			)
			.run("edge-old", iso(800), iso(750));

		// Change events (90d = 2160h)
		raw
			.prepare(
				`INSERT INTO change_events (id, project_id, environment, kind, source, target_node_id, summary, occurred_at, received_at) VALUES (?, 'alpha', 'prod', 'deploy', 'ci_webhook', 'n-fresh', 'old deploy', ?, ?)`,
			)
			.run("chg-old", iso(2200), iso(2200));
		raw
			.prepare(
				`INSERT INTO change_events (id, project_id, environment, kind, source, target_node_id, summary, occurred_at, received_at) VALUES (?, 'alpha', 'prod', 'deploy', 'ci_webhook', 'n-fresh', 'recent deploy', ?, ?)`,
			)
			.run("chg-recent", iso(100), iso(100));

		// Findings (90d = 2160h, unless counterfactual_verified or operationally_corroborated)
		const insFinding = raw.prepare(
			`INSERT INTO investigation_findings (id, project_id, environment, fingerprint, fingerprint_input_json, title, summary, causal_proof_tier, causal_verification_status, confidence, confidence_breakdown_json, symptom_entity_kind, symptom_entity_id, fault_locus_entity_kind, fault_locus_entity_id, causal_chain_json, cited_evidence_ids_json, actor_type, actor_id, created_at, updated_at) VALUES (?, 'alpha', 'prod', 'fp_1', '{}', 't', 's', 'corroborated_candidate', ?, 0.8, '{}', 'trace', 't1', 'span', 's1', '[]', '["t1"]', 'agent', 'autosre', ?, ?)`,
		);
		insFinding.run("fnd-old-unverified", "unverified", iso(2200), iso(2200));
		insFinding.run(
			"fnd-old-verified",
			"counterfactual_verified",
			iso(2200),
			iso(2200),
		);
		insFinding.run(
			"fnd-old-corroborated",
			"operationally_corroborated",
			iso(2200),
			iso(2200),
		);

		const summary = await purgeSecondaryRows(db, {
			retentionHours: 72,
			now: () => NOW,
		});
		expect(summary.ontology_edges).toBe(1);
		expect(summary.ontology_nodes).toBe(1);
		expect(summary.change_events).toBe(1);
		expect(summary.investigation_findings).toBe(1);

		const remainingFindings = (
			raw
				.prepare(`SELECT id FROM investigation_findings ORDER BY id ASC`)
				.all() as Array<{ id: string }>
		).map((r) => r.id);
		expect(remainingFindings).toEqual([
			"fnd-old-corroborated",
			"fnd-old-verified",
		]);
		db.close();
	});
});
