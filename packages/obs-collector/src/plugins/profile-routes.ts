/**
 * RFC 0007 — pprof profiling receiver + read endpoints.
 *
 *   POST /v1/profiles/pprof              — accepts gzipped pprof blob
 *   GET  /internal/profiles/:id          — proxies the blob back
 *   GET  /internal/profiles/:id?trace_id=… — Phase 4.5 server-side filter
 *
 * Phase 4 minimal scope: ingest-time pprof parsing is deferred. The
 * receiver writes the blob verbatim to R2 / filesystem and reads
 * trace_ids from an `x-obs-trace-ids` header (comma-separated). The
 * @obs/telemetry-sdk profile helper will stamp this; eBPF agents that
 * don't emit the header just don't populate `profile_trace_index`,
 * which means the trace waterfall's 🔥 badge won't fire for those
 * profiles. Aggregate views still work.
 *
 * A follow-on commit can add server-side pprof parsing using a Buf-
 * generated schema or pprof-format. The endpoint shape doesn't change
 * when that lands.
 */

import type { CollectorPlugin } from "../framework/collector";
import {
	decodePprofBlob,
	extractTraceIdsFromProfile,
	filterPprofByTraceId,
} from "../lib/parse-pprof";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

const PROFILE_TYPES = new Set([
	"cpu",
	"heap",
	"wall",
	"block",
	"mutex",
	"goroutine",
	"offcpu",
]);

// Time-sortable random id for profile blob keys. Not a real ULID — no
// monotonic clock and we use modulo over crypto bytes for the random
// suffix — but the format (10-char time prefix + 16-char random) gives
// us lexicographic ordering by ingest time, which is what the R2 path
// layout assumes. The "ULID" name was misleading.
const profileId = (): string => {
	const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	let timeStr = "";
	let n = Date.now();
	for (let i = 0; i < 10; i++) {
		timeStr = ENCODING[n % 32] + timeStr;
		n = Math.floor(n / 32);
	}
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	let randStr = "";
	for (let i = 0; i < 16; i++) randStr += ENCODING[bytes[i] % 32];
	return timeStr + randStr;
};

// Parse a non-negative integer from an untrusted source. Returns the
// fallback when the input is missing, malformed, NaN, negative, or
// non-finite. parseInt happily returns NaN for "foo" and that NaN was
// being written verbatim to D1 as "Invalid Date" / NaN before this
// landed.
const parseNonNegInt = (value: string | null | undefined, fallback: number): number => {
	if (value == null) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0) return fallback;
	return parsed;
};

const TRACE_ID_RE = /^[0-9a-f]{16,32}$/i;

const parseTraceIdsHeader = (header: string | null | undefined): string[] => {
	if (!header) return [];
	return header
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter((s) => TRACE_ID_RE.test(s));
};

export const profileRoutesPlugin: CollectorPlugin = {
	name: "profile-routes",
	register(app, runtime) {
		// ── POST /v1/profiles/pprof ─────────────────────────────────────
		app.post("/v1/profiles/pprof", async (c) => {
			const projectId = getProjectId(c);

			const profileType = (
				c.req.header("x-obs-profile-type") || "cpu"
			).toLowerCase();
			if (!PROFILE_TYPES.has(profileType)) {
				return c.json(
					{ error: `unknown profile type: ${profileType}` },
					400,
				);
			}
			const serviceName = c.req.header("x-obs-service") || null;
			// RFC 0007 acceptance #2 — ingest-time pprof parsing.
			// The x-obs-trace-ids header is honored as a pre-extraction
			// fast path (clients that already iterated the profile
			// avoid us re-parsing on the worker), but we no longer
			// require it: when absent, parse the blob and read sample
			// labels directly. Closes the Phase 4 header-driven
			// shortcut.
			const headerTraceIds = parseTraceIdsHeader(
				c.req.header("x-obs-trace-ids"),
			);

			const body = await c.req.arrayBuffer();
			if (body.byteLength === 0) {
				return c.json({ error: "empty body" }, 400);
			}
			if (body.byteLength > 4 * 1024 * 1024) {
				return c.json({ error: "blob too large (max 4 MB)" }, 413);
			}

			let traceIds: string[];
			let parsedSampleCount: number | null = null;
			if (headerTraceIds.length > 0) {
				// Client pre-extracted trace ids — accept verbatim without
				// re-parsing. Decode failures on the blob itself are reported
				// at read time.
				traceIds = headerTraceIds;
			} else {
				try {
					const profile = await decodePprofBlob(body);
					traceIds = extractTraceIdsFromProfile(profile);
					parsedSampleCount = profile.samples.length;
				} catch (err) {
					// No client-side trace_id header and the blob doesn't
					// decode. Return 422 so the agent learns its emit path
					// is broken — silently accepting corrupt blobs into R2
					// makes ingest debugging impossible.
					runtime.logger.warn(
						"[profile-receiver] pprof parse failed (no header fallback)",
						{
							project_id: projectId,
							size: body.byteLength,
							error: err instanceof Error ? err.message : String(err),
						},
					);
					return c.json(
						{
							error: "pprof decode failed",
							hint: "Set x-obs-trace-ids header to bypass server-side parsing.",
							details: err instanceof Error ? err.message : String(err),
						},
						422,
					);
				}
			}

			const id = profileId();
			const now = new Date();
			const nowStr = now.toISOString();
			const dateKey = nowStr.slice(0, 10);
			const objectKey = `profiles/${projectId}/${dateKey}/${id}.pprof.gz`;

			// Storage dispatch — R2 first, no fallback yet (Workers-only).
			if (!c.env.PROFILES_BUCKET) {
				runtime.logger.error("PROFILES_BUCKET binding is missing", {
					project_id: projectId,
				});
				return c.json({ error: "Profile storage not configured" }, 500);
			}
			await c.env.PROFILES_BUCKET.put(objectKey, body, {
				httpMetadata: { contentType: "application/octet-stream" },
			});

			// 72-hour default, clamped to a sane upper bound so a misconfigured
			// env var can't push expires_at thousands of years out.
			const RETENTION_MAX_HOURS = 24 * 90;
			const retentionHours = Math.min(
				parseNonNegInt(c.env.RETENTION_HOURS, 72),
				RETENTION_MAX_HOURS,
			);
			const expiresAt = new Date(
				now.getTime() + retentionHours * 60 * 60 * 1000,
			).toISOString();

			// Duration / window are optional headers; default to "now".
			// Untrusted client input — parseNonNegInt drops NaN / negative.
			const durationMs = parseNonNegInt(
				c.req.header("x-obs-duration-ms"),
				0,
			);
			const startTs = c.req.header("x-obs-start-ts") || nowStr;

			const db = sqlDbFor(c.env);
			await db
				.prepare(
					`INSERT INTO profile_blobs (
						id, project_id, service_name, profile_type,
						start_ts, end_ts, duration_ms, blob_size_bytes, blob_url,
						sample_count, agent, resource_attrs_json,
						received_at, expires_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					id,
					projectId,
					serviceName,
					profileType,
					startTs,
					nowStr,
					durationMs,
					body.byteLength,
					objectKey,
					parsedSampleCount,
					c.req.header("x-obs-agent") || "unknown",
					null,
					nowStr,
					expiresAt,
				)
				.run();

			if (traceIds.length > 0) {
				const stmt = db.prepare(
					`INSERT OR IGNORE INTO profile_trace_index (profile_id, trace_id, project_id) VALUES (?, ?, ?)`,
				);
				const batch = traceIds.map((tid) => stmt.bind(id, tid, projectId));
				await db.batch(batch);
			}

			return c.json(
				{
					accepted: true,
					profileId: id,
					traceIdsIndexed: traceIds.length,
				},
				202,
			);
		});

		// ── GET /internal/profiles/:id ─────────────────────────────────
		app.get("/internal/profiles/:id", async (c) => {
			const projectId = getProjectId(c);
			const id = c.req.param("id");
			const db = sqlDbFor(c.env);

			const meta = await db
				.prepare(
					`SELECT id, service_name, profile_type, start_ts, end_ts,
							duration_ms, blob_size_bytes, blob_url, sample_count,
							agent, received_at, expires_at
					 FROM profile_blobs
					 WHERE project_id = ? AND id = ?`,
				)
				.bind(projectId, id)
				.first<{
					id: string;
					service_name: string | null;
					profile_type: string;
					start_ts: string;
					end_ts: string;
					duration_ms: number;
					blob_size_bytes: number;
					blob_url: string;
					sample_count: number | null;
					agent: string | null;
					received_at: string;
					expires_at: string;
				}>();

			if (!meta) {
				return c.json({ error: "Not found" }, 404);
			}

			// Optional: download the blob inline. Default returns metadata
			// only; the dashboard's flame graph viewer will fetch the blob
			// separately via ?blob=true.
			if (c.req.query("blob") === "true") {
				if (!c.env.PROFILES_BUCKET) {
					return c.json({ error: "Profile storage not configured" }, 500);
				}
				const obj = await c.env.PROFILES_BUCKET.get(meta.blob_url);
				if (!obj) {
					return c.json({ error: "Blob not found in storage" }, 404);
				}
				// RFC 0007 acceptance #6 — server-side pre-filter.
				// When `?trace_id=X` is set alongside `?blob=true`, parse
				// the pprof, retain only samples with the matching label,
				// and re-emit a smaller blob. Saves bandwidth on large
				// JVM profiles where 99% of samples don't belong to the
				// trace the user is drilling into.
				const filterTraceId = c.req.query("trace_id");
				if (filterTraceId) {
					const raw = new Uint8Array(await obj.arrayBuffer());
					try {
						const profile = await decodePprofBlob(raw);
						const filtered = await filterPprofByTraceId(
							profile,
							filterTraceId,
						);
						return new Response(filtered as unknown as BodyInit, {
							headers: {
								"Content-Type": "application/octet-stream",
								"Content-Encoding": "gzip",
								"Content-Disposition": `attachment; filename="${id}-trace-${filterTraceId.slice(0, 8)}.pprof.gz"`,
								// Surface the size shrink so the UI can show savings.
								"X-Obs-Filter-Original-Bytes": String(raw.byteLength),
								"X-Obs-Filter-Filtered-Bytes": String(filtered.byteLength),
							},
						});
					} catch (err) {
						runtime.logger.warn(
							"[profile-routes] filter failed; returning unfiltered blob",
							{
								profile_id: id,
								trace_id: filterTraceId,
								error: err instanceof Error ? err.message : String(err),
							},
						);
						// Fall through to unfiltered.
					}
				}
				return new Response(obj.body, {
					headers: {
						"Content-Type": "application/octet-stream",
						"Content-Disposition": `attachment; filename="${id}.pprof.gz"`,
					},
				});
			}

			// Metadata + trace_id list (no blob). The full server-side
			// pprof filter runs above when `?blob=true&trace_id=…`.
			const trace_id = c.req.query("trace_id");
			const traces = await db
				.prepare(
					trace_id
						? `SELECT trace_id FROM profile_trace_index WHERE profile_id = ? AND project_id = ? AND trace_id = ?`
						: `SELECT trace_id FROM profile_trace_index WHERE profile_id = ? AND project_id = ? LIMIT 1000`,
				)
				.bind(
					...(trace_id
						? [meta.id, projectId, trace_id]
						: [meta.id, projectId]),
				)
				.all<{ trace_id: string }>();

			return c.json({
				profile: {
					id: meta.id,
					serviceName: meta.service_name,
					profileType: meta.profile_type,
					startTs: meta.start_ts,
					endTs: meta.end_ts,
					durationMs: meta.duration_ms,
					blobSizeBytes: meta.blob_size_bytes,
					sampleCount: meta.sample_count,
					agent: meta.agent,
					receivedAt: meta.received_at,
					expiresAt: meta.expires_at,
				},
				traceIds: traces.results.map((r) => r.trace_id),
				traceIdRequested: trace_id ?? null,
			});
		});

		// ── GET /internal/profiles ─────────────────────────────────────
		// Recent profiles, optionally scoped by trace_id (powers the
		// 🔥 badge on the trace waterfall).
		app.get("/internal/profiles", async (c) => {
			const projectId = getProjectId(c);
			const traceId = c.req.query("trace_id");
			const serviceName = c.req.query("service");
			const db = sqlDbFor(c.env);

			if (traceId) {
				const rows = await db
					.prepare(
						`SELECT b.id, b.service_name, b.profile_type, b.start_ts, b.end_ts,
								b.duration_ms, b.blob_size_bytes, b.agent
						 FROM profile_trace_index i
						 JOIN profile_blobs b ON b.id = i.profile_id
						 WHERE i.project_id = ? AND i.trace_id = ?
						 ORDER BY b.end_ts DESC
						 LIMIT 50`,
					)
					.bind(projectId, traceId)
					.all<{
						id: string;
						service_name: string | null;
						profile_type: string;
						start_ts: string;
						end_ts: string;
						duration_ms: number;
						blob_size_bytes: number;
						agent: string | null;
					}>();
				return c.json({
					profiles: rows.results.map((r) => ({
						id: r.id,
						serviceName: r.service_name,
						profileType: r.profile_type,
						startTs: r.start_ts,
						endTs: r.end_ts,
						durationMs: r.duration_ms,
						blobSizeBytes: r.blob_size_bytes,
						agent: r.agent,
					})),
				});
			}

			let sql = `SELECT id, service_name, profile_type, start_ts, end_ts,
						 duration_ms, blob_size_bytes, agent
				FROM profile_blobs WHERE project_id = ?`;
			const binds: unknown[] = [projectId];
			if (serviceName) {
				sql += ` AND service_name = ?`;
				binds.push(serviceName);
			}
			sql += ` ORDER BY end_ts DESC LIMIT 50`;

			const rows = await db
				.prepare(sql)
				.bind(...binds)
				.all<{
					id: string;
					service_name: string | null;
					profile_type: string;
					start_ts: string;
					end_ts: string;
					duration_ms: number;
					blob_size_bytes: number;
					agent: string | null;
				}>();

			return c.json({
				profiles: rows.results.map((r) => ({
					id: r.id,
					serviceName: r.service_name,
					profileType: r.profile_type,
					startTs: r.start_ts,
					endTs: r.end_ts,
					durationMs: r.duration_ms,
					blobSizeBytes: r.blob_size_bytes,
					agent: r.agent,
				})),
			});
		});
	},
};
