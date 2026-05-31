/**
 * UsageStore — union of all repos.
 * - A's in-memory aggregation approach (more flexible, handles legacy load time keys)
 * - A's broader error detection (event_type='frontend_error' OR severity='error')
 * - A's multi-key load time parsing (loadTimeMs, load_time_ms, durationMs)
 * - A's purgeExpired()
 * - A's summarizeMap helper
 */

import type {
	UsageBrowserSummary,
	UsageCountrySummary,
	UsageDeviceSummary,
	UsageErrorSummary,
	UsageEventRecord,
	UsageEventRow,
	UsageEventSummary,
	UsageOSSummary,
	UsageOverviewOptions,
	UsageOverviewResponse,
	UsagePageSummary,
	UsageSessionDetailResponse,
	UsageSessionSummary,
	UsageUtmCampaignSummary,
	UsageUtmMediumSummary,
	UsageUtmSourceSummary,
} from "@obs-unified/types";

import { parseJsonRecord } from "./json";
import type { SqlDb } from "./sql-db";

const cutoffIso = (hours: number): string =>
	new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const summarizeMap = <T>(
	map: Map<string, number>,
	build: (value: string, count: number) => T,
): T[] =>
	Array.from(map.entries())
		.map(([value, count]) => build(value, count))
		.sort((left, right) => {
			const leftCount = (left as { count: number }).count;
			const rightCount = (right as { count: number }).count;
			return rightCount - leftCount;
		})
		.slice(0, 10);

const filterRow = (
	row: UsageEventRow,
	options: UsageOverviewOptions,
	cutoff: string,
): boolean => {
	if (row.occurred_at < cutoff) return false;
	if (options.path && row.page_path !== options.path) return false;
	if (!options.includeAdmin) {
		const context = parseJsonRecord(row.context_json);
		if (context["collector.is_admin_path"] === true) return false;
	}
	return true;
};

const toSessionSummary = (rows: UsageEventRow[]): UsageSessionSummary => {
	const sorted = [...rows].sort((left, right) =>
		left.occurred_at.localeCompare(right.occurred_at),
	);
	const first = sorted[0];
	const last = sorted[sorted.length - 1];

	return {
		sessionId: first.session_id,
		visitorId: first.visitor_id,
		firstSeen: first.occurred_at,
		lastSeen: last.occurred_at,
		eventCount: sorted.length,
		pageViewCount: sorted.filter((row) => row.event_type === "page_view")
			.length,
		errorCount: sorted.filter(
			(row) => row.event_type === "frontend_error" || row.severity === "error",
		).length,
		lastPath: last.page_path,
		referrer: first.referrer,
	};
};

export class UsageStore {
	constructor(private readonly db: SqlDb) {}

	async ingest(
		events: UsageEventRecord[],
	): Promise<{ inserted: number; sessionCount: number }> {
		if (events.length === 0) return { inserted: 0, sessionCount: 0 };

		const statements = events.map((event) => {
			if (!event.projectId)
				throw new Error("UsageStore.ingest: event.projectId is required");
			return this.db
				.prepare(`
        INSERT OR IGNORE INTO usage_events (
          project_id, event_id, session_id, visitor_id, event_type, event_name,
          page_path, page_title, referrer, severity, source,
          context_json, properties_json, user_agent, occurred_at,
          received_at, expires_at, country, browser, os,
          device_type, is_bot, utm_source, utm_medium, utm_campaign,
          interaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
				.bind(
					event.projectId,
					event.eventId,
					event.sessionId,
					event.visitorId,
					event.eventType,
					event.eventName,
					event.pagePath,
					event.pageTitle,
					event.referrer,
					event.severity,
					event.source,
					event.contextJson,
					event.propertiesJson,
					event.userAgent,
					event.occurredAt,
					event.receivedAt,
					event.expiresAt,
					event.country,
					event.browser,
					event.os,
					event.deviceType,
					event.isBot ? 1 : 0,
					event.utmSource,
					event.utmMedium,
					event.utmCampaign,
					event.interactionId ?? null,
				);
		});

		await this.db.batch(statements);
		return {
			inserted: events.length,
			sessionCount: new Set(events.map((event) => event.sessionId)).size,
		};
	}

	async getOverview(
		options: UsageOverviewOptions,
	): Promise<UsageOverviewResponse> {
		if (!options.projectId)
			throw new Error("UsageStore.getOverview: projectId is required");
		const cutoff = cutoffIso(options.hours);
		const result = await this.db
			.prepare(`
      SELECT project_id, event_id, session_id, visitor_id, event_type, event_name,
             page_path, page_title, referrer, severity, source,
             context_json, properties_json, user_agent, occurred_at,
             received_at, country, browser, os, device_type, is_bot,
             utm_source, utm_medium, utm_campaign
      FROM usage_events
      WHERE project_id = ? AND occurred_at >= ?
      ORDER BY occurred_at DESC
      LIMIT 10000
    `)
			.bind(options.projectId, cutoff)
			.all<UsageEventRow>();

		const rows = (result.results ?? []).filter((row) =>
			filterRow(row, options, cutoff),
		);
		const pageMap = new Map<
			string,
			{
				path: string;
				title: string | null;
				views: number;
				sessions: Set<string>;
				loadTimes: number[];
				errorCount: number;
			}
		>();
		const eventMap = new Map<
			string,
			{
				eventName: string;
				eventType: UsageEventSummary["eventType"];
				totalEvents: number;
				sessions: Set<string>;
			}
		>();
		const sessions = new Map<string, UsageEventRow[]>();
		const browsers = new Map<string, number>();
		const operatingSystems = new Map<string, number>();
		const devices = new Map<string, number>();
		const countries = new Map<string, number>();
		const utmSources = new Map<string, number>();
		const utmMediums = new Map<string, number>();
		const utmCampaigns = new Map<string, number>();
		const hourlyPageViews = new Map<string, number>();
		const frontendErrors: UsageErrorSummary[] = [];

		let pageViews = 0;
		let interactions = 0;
		let frontendErrorCount = 0;
		let botsFiltered = 0;

		for (const row of rows) {
			if (row.is_bot) botsFiltered += 1;

			const sessionRows = sessions.get(row.session_id) ?? [];
			sessionRows.push(row);
			sessions.set(row.session_id, sessionRows);

			const eventKey = `${row.event_type}:${row.event_name}`;
			const eventEntry = eventMap.get(eventKey) ?? {
				eventName: row.event_name,
				eventType: row.event_type,
				totalEvents: 0,
				sessions: new Set<string>(),
			};
			eventEntry.totalEvents += 1;
			eventEntry.sessions.add(row.session_id);
			eventMap.set(eventKey, eventEntry);

			if (row.browser)
				browsers.set(row.browser, (browsers.get(row.browser) ?? 0) + 1);
			if (row.os)
				operatingSystems.set(row.os, (operatingSystems.get(row.os) ?? 0) + 1);
			if (row.device_type)
				devices.set(row.device_type, (devices.get(row.device_type) ?? 0) + 1);
			if (row.country)
				countries.set(row.country, (countries.get(row.country) ?? 0) + 1);
			if (row.utm_source)
				utmSources.set(
					row.utm_source,
					(utmSources.get(row.utm_source) ?? 0) + 1,
				);
			if (row.utm_medium)
				utmMediums.set(
					row.utm_medium,
					(utmMediums.get(row.utm_medium) ?? 0) + 1,
				);
			if (row.utm_campaign)
				utmCampaigns.set(
					row.utm_campaign,
					(utmCampaigns.get(row.utm_campaign) ?? 0) + 1,
				);

			if (row.event_type === "page_view") {
				pageViews += 1;
				const hour = `${row.occurred_at.slice(0, 13)}:00:00.000Z`;
				hourlyPageViews.set(hour, (hourlyPageViews.get(hour) ?? 0) + 1);

				if (row.page_path) {
					const pageEntry = pageMap.get(row.page_path) ?? {
						path: row.page_path,
						title: row.page_title,
						views: 0,
						sessions: new Set<string>(),
						loadTimes: [],
						errorCount: 0,
					};
					pageEntry.views += 1;
					pageEntry.sessions.add(row.session_id);
					if (!pageEntry.title && row.page_title)
						pageEntry.title = row.page_title;

					// Multi-key load time parsing (from A)
					const properties = parseJsonRecord(row.properties_json);
					const loadTimeValue =
						properties.loadTimeMs ??
						properties.load_time_ms ??
						properties.durationMs;
					const loadTime =
						typeof loadTimeValue === "number"
							? loadTimeValue
							: typeof loadTimeValue === "string"
								? Number(loadTimeValue)
								: NaN;
					if (Number.isFinite(loadTime)) pageEntry.loadTimes.push(loadTime);

					pageMap.set(row.page_path, pageEntry);
				}
			} else if (row.event_type === "interaction") {
				interactions += 1;
			} else if (row.event_type === "frontend_error") {
				frontendErrorCount += 1;
				const properties = parseJsonRecord(row.properties_json);
				frontendErrors.push({
					eventId: row.event_id,
					sessionId: row.session_id,
					pagePath: row.page_path,
					errorName:
						typeof properties.errorName === "string"
							? properties.errorName
							: null,
					errorMessage:
						typeof properties.errorMessage === "string"
							? properties.errorMessage
							: null,
					component:
						typeof properties.component === "string"
							? properties.component
							: null,
					occurredAt: row.occurred_at,
				});
			}

			// Broader error detection (from A)
			if (
				row.page_path &&
				(row.event_type === "frontend_error" || row.severity === "error")
			) {
				const pageEntry = pageMap.get(row.page_path) ?? {
					path: row.page_path,
					title: row.page_title,
					views: 0,
					sessions: new Set<string>(),
					loadTimes: [],
					errorCount: 0,
				};
				pageEntry.errorCount += 1;
				pageMap.set(row.page_path, pageEntry);
			}
		}

		const pages: UsagePageSummary[] = Array.from(pageMap.values())
			.map((entry) => ({
				path: entry.path,
				title: entry.title,
				views: entry.views,
				uniqueSessions: entry.sessions.size,
				averageLoadTimeMs:
					entry.loadTimes.length > 0
						? Math.round(
								entry.loadTimes.reduce((sum, v) => sum + v, 0) /
									entry.loadTimes.length,
							)
						: 0,
				errorCount: entry.errorCount,
			}))
			.sort(
				(left, right) =>
					right.views - left.views || left.path.localeCompare(right.path),
			)
			.slice(0, options.limit ?? 20);

		const recentSessions = Array.from(sessions.values())
			.map((sessionRows) => toSessionSummary(sessionRows))
			.sort((left, right) => right.lastSeen.localeCompare(left.lastSeen))
			.slice(0, 20);

		return {
			summary: {
				totalEvents: rows.length,
				uniqueSessions: sessions.size,
				uniqueVisitors: new Set(rows.map((row) => row.visitor_id)).size,
				pageViews,
				frontendErrors: frontendErrorCount,
				interactions,
			},
			pages,
			events: Array.from(eventMap.values())
				.map((entry) => ({
					eventName: entry.eventName,
					eventType: entry.eventType,
					totalEvents: entry.totalEvents,
					uniqueSessions: entry.sessions.size,
				}))
				.sort(
					(left, right) =>
						right.totalEvents - left.totalEvents ||
						left.eventName.localeCompare(right.eventName),
				)
				.slice(0, 20),
			recentSessions,
			frontendErrors: frontendErrors
				.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
				.slice(0, 20),
			browsers: summarizeMap<UsageBrowserSummary>(
				browsers,
				(browser, count) => ({ browser, count }),
			),
			operatingSystems: summarizeMap<UsageOSSummary>(
				operatingSystems,
				(os, count) => ({ os, count }),
			),
			devices: summarizeMap<UsageDeviceSummary>(devices, (device, count) => ({
				device,
				count,
			})),
			countries: summarizeMap<UsageCountrySummary>(
				countries,
				(country, count) => ({ country, count }),
			),
			utmSources: summarizeMap<UsageUtmSourceSummary>(
				utmSources,
				(source, count) => ({ source, count }),
			),
			utmMediums: summarizeMap<UsageUtmMediumSummary>(
				utmMediums,
				(medium, count) => ({ medium, count }),
			),
			utmCampaigns: summarizeMap<UsageUtmCampaignSummary>(
				utmCampaigns,
				(campaign, count) => ({ campaign, count }),
			),
			hourlyPageViews: Array.from(hourlyPageViews.entries())
				.map(([hour, count]) => ({ hour, count }))
				.sort((left, right) => left.hour.localeCompare(right.hour)),
			botsFiltered,
			filters: {
				path: options.path ?? "all",
				includeAdmin: options.includeAdmin ?? false,
			},
			windowHours: options.hours,
			timestamp: new Date().toISOString(),
		};
	}

	async getSessionDetail(
		sessionId: string,
		projectId: string,
	): Promise<UsageSessionDetailResponse | null> {
		if (!projectId)
			throw new Error("UsageStore.getSessionDetail: projectId is required");
		const result = await this.db
			.prepare(`
      SELECT project_id, event_id, session_id, visitor_id, event_type, event_name,
             page_path, page_title, referrer, severity, source,
             context_json, properties_json, user_agent, occurred_at,
             received_at, country, browser, os, device_type, is_bot,
             utm_source, utm_medium, utm_campaign
      FROM usage_events
      WHERE project_id = ? AND session_id = ?
      ORDER BY occurred_at ASC
    `)
			.bind(projectId, sessionId)
			.all<UsageEventRow>();

		const rows = result.results ?? [];
		if (rows.length === 0) return null;

		return {
			session: toSessionSummary(rows),
			events: rows.map((row) => ({
				eventId: row.event_id,
				eventType: row.event_type,
				eventName: row.event_name,
				pagePath: row.page_path,
				pageTitle: row.page_title,
				severity: row.severity ?? "info",
				occurredAt: row.occurred_at,
				properties: parseJsonRecord(row.properties_json),
				context: parseJsonRecord(row.context_json),
			})),
			timestamp: new Date().toISOString(),
		};
	}

	/**
	 * List sessions with an optional qualitative filter.
	 *
	 * Aggregates per session_id in a single query; supports three filters
	 * derived from session-level rollups: sessions that errored, sessions
	 * with no interactions (engagement drop-off), and sessions with slow
	 * page loads.
	 */
	async listSessions(options: {
		projectId: string;
		hours: number;
		filter: "all" | "ended_in_error" | "dropoff" | "slow";
		slowMs?: number;
		limit?: number;
	}): Promise<{
		sessions: Array<
			UsageSessionSummary & {
				interactionCount: number;
				maxLoadTimeMs: number | null;
			}
		>;
	}> {
		if (!options.projectId)
			throw new Error("UsageStore.listSessions: projectId is required");
		const cutoff = cutoffIso(options.hours);
		const slowMs = options.slowMs ?? 3000;
		const limit = Math.max(1, Math.min(1000, options.limit ?? 200));

		const result = await this.db
			.prepare(
				`SELECT
					session_id,
					MIN(visitor_id) AS visitor_id,
					MIN(occurred_at) AS first_seen,
					MAX(occurred_at) AS last_seen,
					COUNT(*) AS event_count,
					SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_view_count,
					SUM(CASE WHEN event_type = 'interaction' THEN 1 ELSE 0 END) AS interaction_count,
					SUM(CASE WHEN event_type = 'frontend_error' OR severity = 'error' THEN 1 ELSE 0 END) AS error_count,
					MAX(CASE WHEN event_type = 'page_view' THEN CAST(COALESCE(json_extract(properties_json, '$.loadTimeMs'), json_extract(properties_json, '$.load_time_ms'), json_extract(properties_json, '$.durationMs')) AS REAL) ELSE NULL END) AS max_load_ms,
					(SELECT referrer FROM usage_events ref WHERE ref.project_id = ue.project_id AND ref.session_id = ue.session_id ORDER BY occurred_at ASC LIMIT 1) AS referrer,
					(SELECT page_path FROM usage_events lp WHERE lp.project_id = ue.project_id AND lp.session_id = ue.session_id ORDER BY occurred_at DESC LIMIT 1) AS last_path
				FROM usage_events ue
				WHERE project_id = ? AND received_at >= ?
				GROUP BY session_id
				ORDER BY last_seen DESC
				LIMIT ?`,
			)
			.bind(options.projectId, cutoff, limit * 3)
			.all<{
				session_id: string;
				visitor_id: string;
				first_seen: string;
				last_seen: string;
				event_count: number;
				page_view_count: number;
				interaction_count: number;
				error_count: number;
				max_load_ms: number | null;
				referrer: string | null;
				last_path: string | null;
			}>();

		const raw = (result.results ?? []).map((r) => ({
			sessionId: r.session_id,
			visitorId: r.visitor_id,
			firstSeen: r.first_seen,
			lastSeen: r.last_seen,
			eventCount: r.event_count,
			pageViewCount: r.page_view_count,
			errorCount: r.error_count,
			lastPath: r.last_path,
			referrer: r.referrer,
			interactionCount: r.interaction_count,
			maxLoadTimeMs: r.max_load_ms,
		}));

		const filtered = raw.filter((s) => {
			switch (options.filter) {
				case "ended_in_error":
					return s.errorCount > 0;
				case "dropoff":
					return s.pageViewCount >= 1 && s.interactionCount === 0;
				case "slow":
					return s.maxLoadTimeMs !== null && s.maxLoadTimeMs >= slowMs;
				default:
					return true;
			}
		});

		return { sessions: filtered.slice(0, limit) };
	}

	async purgeExpired(): Promise<number> {
		const now = new Date().toISOString();
		const result = await this.db
			.prepare("DELETE FROM usage_events WHERE expires_at <= ?")
			.bind(now)
			.run();
		return result.meta?.changes ?? 0;
	}
}
