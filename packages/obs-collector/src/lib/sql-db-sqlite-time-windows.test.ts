/**
 * Real-SQLite regression for the D1 time-window bug: every timestamp column
 * stores `Date#toISOString()` text (`2026-10-13T05:04:53.123Z`), but the
 * dialect and the shared analysis SQL used `datetime('now', …)`, which
 * renders `2026-10-13 05:04:53`. In a text comparison the space sorts before
 * `T`, so "last 5 minutes" matched the whole current UTC day and
 * `expires_at < now` purges ran a day late. The expressions now render ISO
 * text via `strftime('%Y-%m-%dT%H:%M:%fZ', …)`; these tests execute them.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredSpan } from "@obsunified/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveAnalysesForProject } from "../analyses/derive";
import { INVESTIGATION_ANALYSES } from "../analyses/investigations";
import { TIER0_ANALYSES } from "../analyses/tier0";
import { purgeExpiredAIData } from "./ai-store/retention";
import { runSqlAnalysis } from "./analyses-runner";
import { SQLITE_ISO_FORMAT, sqliteDialect, sqliteIsoNow } from "./sql-db";
import { ingestTelemetrySpans } from "./store/ingest";
import {
	createMigratedSqliteDb,
	type NodeSqliteDb,
} from "./test-utils/node-sqlite-db";

const ISO_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PROJECT = "alpha";

const minutesAgo = (minutes: number): string =>
	new Date(Date.now() - minutes * 60_000).toISOString();

const span = (over: Partial<StoredSpan>): StoredSpan => ({
	projectId: PROJECT,
	traceId: "trace-1",
	spanId: "span-1",
	parentSpanId: null,
	traceState: null,
	serviceName: "checkout",
	scopeName: null,
	scopeVersion: null,
	spanName: "GET /",
	spanKind: 2,
	statusCode: 1,
	statusMessage: null,
	startTime: minutesAgo(1),
	endTime: minutesAgo(1),
	durationMs: 12,
	attributesJson: "{}",
	droppedAttributesCount: 0,
	resourceAttributesJson: "{}",
	eventsJson: "[]",
	droppedEventsCount: 0,
	linksJson: "[]",
	droppedLinksCount: 0,
	receivedAt: minutesAgo(1),
	expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
	sessionId: null,
	interactionId: null,
	...over,
});

describe("sqliteDialect time windows against ISO text columns", () => {
	let db: NodeSqliteDb;

	beforeAll(async () => {
		db = createMigratedSqliteDb();
		await ingestTelemetrySpans(db, [
			// inside the 5-minute window, and an error
			span({
				spanId: "recent-error",
				statusCode: 2,
				receivedAt: minutesAgo(2),
			}),
			// inside the 1-hour baseline only
			span({ spanId: "base-1", receivedAt: minutesAgo(30) }),
			span({ spanId: "base-2", receivedAt: minutesAgo(30) }),
			span({ spanId: "base-3", receivedAt: minutesAgo(30) }),
			// outside both windows, but still "today" in UTC for most of the day
			span({ spanId: "old", receivedAt: minutesAgo(120) }),
		]);
	});

	afterAll(() => db.close());

	it("renders now() and relative windows in the shape Date#toISOString writes", async () => {
		const row = await db
			.prepare(
				`SELECT ${sqliteDialect.now()} AS now_iso,
				        ${sqliteDialect.sinceMinutes("?")} AS minutes_iso,
				        ${sqliteDialect.sinceHours("?")} AS hours_iso`,
			)
			.bind(5, 1)
			.first<{ now_iso: string; minutes_iso: string; hours_iso: string }>();
		expect(row?.now_iso).toMatch(ISO_TEXT);
		expect(row?.minutes_iso).toMatch(ISO_TEXT);
		expect(row?.hours_iso).toMatch(ISO_TEXT);
		const now = Date.parse(row?.now_iso ?? "");
		expect(Math.abs(now - Date.now())).toBeLessThan(5_000);
		expect(now - Date.parse(row?.minutes_iso ?? "")).toBe(5 * 60_000);
		expect(now - Date.parse(row?.hours_iso ?? "")).toBe(60 * 60_000);
		expect(sqliteIsoNow()).toBe(`strftime('${SQLITE_ISO_FORMAT}', 'now')`);
	});

	it("sinceMinutes / sinceHours select only rows inside the window", async () => {
		const count = async (where: string, ...binds: unknown[]) => {
			const row = await db
				.prepare(
					`SELECT COUNT(*) AS n FROM telemetry_spans WHERE project_id = ? AND ${where}`,
				)
				.bind(PROJECT, ...binds)
				.first<{ n: number }>();
			return row?.n ?? -1;
		};
		expect(
			await count(`received_at >= ${sqliteDialect.sinceMinutes("?")}`, 5),
		).toBe(1);
		expect(
			await count(`received_at >= ${sqliteDialect.sinceHours("?")}`, 1),
		).toBe(4);
		expect(
			await count(
				`received_at >= ${sqliteDialect.sinceHours("?")} AND received_at < ${sqliteDialect.sinceMinutes("?")}`,
				1,
				5,
			),
		).toBe(3);
	});

	it("purges rows whose ISO expires_at has passed and keeps the rest", async () => {
		const insert = db.prepare(
			`INSERT INTO ai_span_payloads (project_id, trace_id, span_id, span_kind, received_at, expires_at)
			 VALUES (?, ?, ?, 'LLM', ?, ?)`,
		);
		await db.batch([
			insert.bind(PROJECT, "t", "expired", minutesAgo(120), minutesAgo(1)),
			insert.bind(
				PROJECT,
				"t",
				"live",
				minutesAgo(1),
				new Date(Date.now() + 60_000).toISOString(),
			),
		]);
		await purgeExpiredAIData(db);
		const rows = await db
			.prepare(`SELECT span_id FROM ai_span_payloads ORDER BY span_id`)
			.all<{ span_id: string }>();
		expect(rows.results.map((r) => r.span_id)).toEqual(["live"]);
	});

	it("overall_error_rate sees only the last 5 minutes as the primary window", async () => {
		const def = TIER0_ANALYSES.find((d) => d.id === "overall_error_rate");
		if (!def) throw new Error("overall_error_rate analysis missing");
		const result = await runSqlAnalysis(def, {
			db,
			projectId: PROJECT,
			retentionHours: 24,
		});
		// 1 span in the last 5 minutes and it is an error.
		expect(result.primaryValue).toBe(1);
		// 3 ok spans in [-1h, -5m); the 2-hour-old span is outside both.
		expect(result.baselineValue).toBe(0);
		expect(result.status).toBe("critical");
	});

	it("every built-in and derived analysis executes on SQLite", async () => {
		const derived = await deriveAnalysesForProject(PROJECT, db);
		const defs = [...TIER0_ANALYSES, ...INVESTIGATION_ANALYSES, ...derived];
		expect(defs.length).toBeGreaterThan(TIER0_ANALYSES.length);
		for (const def of defs) {
			if (!def.sql) continue;
			const result = await runSqlAnalysis(def, {
				db,
				projectId: PROJECT,
				retentionHours: 24,
			});
			expect(result.analysisId, def.id).toBe(def.id);
		}
	});

	it("ships no datetime('now') windows in the analysis sources", () => {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const analysesDir = path.resolve(here, "../analyses");
		const offenders: string[] = [];
		for (const file of readdirSync(analysesDir)) {
			if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
			const source = readFileSync(path.join(analysesDir, file), "utf8");
			if (/datetime\(\s*'now'/.test(source)) offenders.push(file);
		}
		expect(offenders).toEqual([]);
	});
});
