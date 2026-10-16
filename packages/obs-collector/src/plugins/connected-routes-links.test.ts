import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { recordInvestigationFinding } from "../lib/autosre-findings";
import { openOrDeduplicateIncident } from "../lib/autosre-remediation-gate";
import { createMigratedSqliteDb } from "../lib/test-utils/node-sqlite-db";
import { connectedRoutesPlugin } from "./connected-routes";

type Link = { href: string; entityKind?: string; entityId?: string };
type Manifest = { up: { links: Link[] }[]; across: { links: Link[] }[] };

const SERVICE_NODE = "service:prod:default:checkout-api";

const setup = () => {
	const db = createMigratedSqliteDb();
	const app = new Hono<{ Bindings: CollectorEnv }>();
	connectedRoutesPlugin.register(app, new CollectorRuntime());
	const env = { DB: db as unknown as D1Database } as CollectorEnv;
	const get = async (path: string) =>
		(await (await app.request(path, {}, env)).json()) as Manifest;
	return { db, get };
};

const openIncident = async (
	db: ReturnType<typeof setup>["db"],
	kind: "trace" | "alert",
	anchorId: string,
) =>
	(
		await openOrDeduplicateIncident(db, "default", {
			environment: "prod",
			targetNodeId: SERVICE_NODE,
			symptomAnchorKind: kind,
			symptomAnchorId: anchorId,
			symptomFingerprint: `fp_${kind}`,
			symptomCategory: `fp_${kind}`,
		})
	).incident;

describe("connected links carry the real entity kind and a matching href", () => {
	it("incident trigger signal for a trace anchor is a trace link", async () => {
		const { db, get } = setup();
		const incident = await openIncident(db, "trace", "trace-123");
		const m = await get(
			`/internal/connected/incident/${incident.id}?environment=prod`,
		);
		expect(m.up[0]?.links[0]).toMatchObject({
			entityKind: "trace",
			entityId: "trace-123",
			href: "#/traces?trace=trace-123",
		});
		db.close();
	});

	it("incident trigger signal for an alert anchor stays an alert link", async () => {
		const { db, get } = setup();
		const incident = await openIncident(db, "alert", "rule-9");
		const m = await get(
			`/internal/connected/incident/${incident.id}?environment=prod`,
		);
		expect(m.up[0]?.links[0]).toMatchObject({
			entityKind: "alert",
			entityId: "rule-9",
			href: "#/alerts?id=rule-9",
		});
		db.close();
	});

	it.each([
		[SERVICE_NODE, "service", "#/service-map?service=checkout-api"],
		["checkout-api", "service", "#/service-map?service=checkout-api"],
	])("finding fault locus %s links as %s", async (locus, kind, href) => {
		const { db, get } = setup();
		const incident = await openIncident(db, "trace", "t1");
		const finding = await recordInvestigationFinding(db, "default", {
			environment: "prod",
			incidentId: incident.id,
			title: "Regression",
			summary: "Errors after deploy",
			causalProofTier: "corroborated_candidate",
			symptomEntityKind: "trace",
			symptomEntityId: "t1",
			faultLocusEntityKind: "service",
			faultLocusEntityId: locus,
			causalChain: [],
			citedEvidenceIds: [],
		});
		const m = await get(
			`/internal/connected/finding/${finding.id}?environment=prod`,
		);
		const link = m.across[0]?.links[0];
		expect(link).toMatchObject({ entityKind: kind, entityId: locus, href });
		db.close();
	});
});
