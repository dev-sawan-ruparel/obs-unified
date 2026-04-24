import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "../use-api";
import {
	BarList as NewBarList,
	Card,
	SectionTitle,
	Stat as NewStat,
	TimeSeriesBars,
	UpdatedChip,
} from "../components/primitives";

interface UsageOverview {
	summary: {
		totalEvents: number;
		uniqueSessions: number;
		uniqueVisitors: number;
		pageViews: number;
		frontendErrors: number;
		interactions: number;
	};
	pages: Array<{
		path: string;
		title: string | null;
		views: number;
		uniqueSessions: number;
		averageLoadTimeMs: number;
		errorCount: number;
	}>;
	events: Array<{
		eventName: string;
		eventType: string;
		totalEvents: number;
		uniqueSessions: number;
	}>;
	recentSessions: Array<{
		sessionId: string;
		visitorId: string;
		firstSeen: string;
		lastSeen: string;
		eventCount: number;
		pageViewCount: number;
		errorCount: number;
		lastPath: string | null;
		referrer: string | null;
	}>;
	frontendErrors: Array<{
		eventId: string;
		sessionId: string;
		pagePath: string | null;
		errorName: string | null;
		errorMessage: string | null;
		component: string | null;
		occurredAt: string;
	}>;
	browsers: Array<{ browser: string; count: number }>;
	operatingSystems: Array<{ os: string; count: number }>;
	devices: Array<{ device: string; count: number }>;
	countries: Array<{ country: string; count: number }>;
	utmSources: Array<{ source: string; count: number }>;
	utmMediums: Array<{ medium: string; count: number }>;
	utmCampaigns: Array<{ campaign: string; count: number }>;
	hourlyPageViews: Array<{ hour: string; count: number }>;
	botsFiltered: number;
	timestamp: string;
}
interface SessionDetail {
	session: {
		sessionId: string;
		visitorId: string;
		firstSeen: string;
		lastSeen: string;
		eventCount: number;
		pageViewCount: number;
		errorCount: number;
	};
	events: Array<{
		eventId: string;
		eventType: string;
		eventName: string;
		pagePath: string | null;
		severity: string;
		occurredAt: string;
		properties: Record<string, unknown>;
		context: Record<string, unknown>;
	}>;
}

const fmtTs = (iso: string) => {
	try {
		const d = new Date(iso);
		return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
	} catch {
		return iso;
	}
};
const copy = (t: string) => {
	void navigator.clipboard.writeText(t);
};

interface Props {
	onNavigate: (route: { tab?: string; sessionId?: string }) => void;
}

type SessionFilter = "all" | "ended_in_error" | "dropoff" | "slow";

interface FilteredSession {
	sessionId: string;
	visitorId: string;
	firstSeen: string;
	lastSeen: string;
	eventCount: number;
	pageViewCount: number;
	errorCount: number;
	lastPath: string | null;
	referrer: string | null;
	interactionCount: number;
	maxLoadTimeMs: number | null;
}

interface FilteredSessionsResponse {
	sessions: FilteredSession[];
	filter: SessionFilter;
	hours: number;
	slowMs: number;
	timestamp: string;
}

export function UsageDashboard({ onNavigate }: Props) {
	const api = useApi();
	const [overview, setOverview] = useState<UsageOverview | null>(null);
	const [loading, setLoading] = useState(true);
	const [hours, setHours] = useState("72");
	const [pathFilter, setPathFilter] = useState("all");
	const [includeAdmin, setIncludeAdmin] = useState(false);
	const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
	const [filteredSessions, setFilteredSessions] = useState<FilteredSession[] | null>(null);

	const [leftWidth, setLeftWidth] = useState(60);

	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const load = async () => {
			const qs = new URLSearchParams();
			qs.set("hours", hours);
			if (pathFilter !== "all") qs.set("path", pathFilter);
			qs.set("includeAdmin", includeAdmin ? "true" : "false");
			try {
				const data = await api<UsageOverview>(`/usage/overview?${qs.toString()}`);
				if (cancelled) return;
				setOverview(data);
				setLoading(false);
			} catch (err) {
				if (cancelled) return;
				console.error(err);
				setLoading(false);
			} finally {
				if (!cancelled) {
					// Poll every 10s while the tab is open (SSE-lite).
					timer = setTimeout(load, 10_000);
				}
			}
		};

		load();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [api, hours, pathFilter, includeAdmin]);

	useEffect(() => {
		if (sessionFilter === "all") {
			setFilteredSessions(null);
			return;
		}
		let cancelled = false;
		(async () => {
			try {
				const qs = new URLSearchParams({
					hours,
					filter: sessionFilter,
					limit: "100",
				});
				const res = await api<FilteredSessionsResponse>(
					`/usage/sessions?${qs.toString()}`,
				);
				if (!cancelled) setFilteredSessions(res.sessions);
			} catch (err) {
				if (!cancelled) {
					console.error(err);
					setFilteredSessions([]);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [api, hours, sessionFilter]);

	const pathOptions = useMemo(
		() => (overview ? ["all", ...overview.pages.map((p) => p.path)] : ["all"]),
		[overview],
	);

	if (loading && !overview)
		return <p className="p-3 text-xs text-stone-500">Loading usage data...</p>;
	if (!overview) return null;

	const s = overview.summary;

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg font-sans text-sys-on-surface p-2">
			{/* Toolbar */}
			<div className="mb-2 flex-none flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2">
				<input
					type="text"
					className="h-8 min-w-[200px] flex-1 border-b-[2px] border-sys-outline bg-transparent px-2 font-mono text-[0.875rem] font-bold placeholder:opacity-40 focus:border-sys-primary focus:outline-none transition-none"
					placeholder="SEARCH PATHS, USERS..."
					disabled
				/>
				<button className="px-3 py-1.5 text-[0.875rem] font-bold uppercase tracking-[0.05em] bg-transparent text-sys-outline outline outline-[1px] outline-sys-outline hover:bg-sys-surface-low hover:text-sys-on-surface transition-none cursor-not-allowed">
					SEARCH
				</button>
				<Sel
					value={hours}
					onChange={(v) => setHours(v)}
					options={[
						["6", "6H"],
						["24", "24H"],
						["72", "72H"],
						["168", "7D"],
						["720", "30D"],
					]}
				/>
				<Sel
					value={pathFilter}
					onChange={setPathFilter}
					options={pathOptions.map((p) => [p, p === "all" ? "ALL PATHS" : p.toUpperCase()])}
				/>
				<label className="flex items-center gap-3 text-[0.75rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface cursor-pointer">
					<input
						type="checkbox"
						checked={includeAdmin}
						onChange={(e) => setIncludeAdmin(e.target.checked)}
						className="accent-sys-primary"
					/>
					ADMIN
				</label>
				<div className="ml-auto">
					<UpdatedChip at={overview.timestamp} />
				</div>
			</div>

			{/* Stats */}
			<div className="mb-2 grid grid-cols-4 xl:grid-cols-7 gap-2">
				<NewStat
					label="Events"
					value={s.totalEvents.toLocaleString()}
					spark={overview.hourlyPageViews.map((b) => b.count)}
				/>
				<NewStat
					label="Sessions"
					value={s.uniqueSessions.toLocaleString()}
					accent="accent"
				/>
				<NewStat
					label="Visitors"
					value={s.uniqueVisitors.toLocaleString()}
					accent="accent"
				/>
				<NewStat
					label="Views"
					value={s.pageViews.toLocaleString()}
					accent="primary"
					spark={overview.hourlyPageViews.map((b) => b.count)}
				/>
				<NewStat
					label="Errors"
					value={s.frontendErrors.toLocaleString()}
					accent={s.frontendErrors > 0 ? "error" : "default"}
				/>
				<NewStat
					label="Interactions"
					value={s.interactions.toLocaleString()}
				/>
				<NewStat
					label="Bots"
					value={overview.botsFiltered.toLocaleString()}
					footer="filtered"
				/>
			</div>

			<div className="flex-1 flex flex-col lg:flex-row gap-2 overflow-hidden">
                {/* Left Primary Area */}
				<div className="flex-[2.5] flex flex-col gap-2 overflow-y-auto pr-2 pb-10 min-h-0">
					{/* Page views over time */}
					<Card className="p-3">
						<SectionTitle
							title="Page views over time"
							note={`${overview.hourlyPageViews.length} hr buckets`}
						/>
						<TimeSeriesBars
							data={overview.hourlyPageViews.map((d) => ({
								t: d.hour,
								v: d.count,
							}))}
						/>
					</Card>

					{/* Breakdowns row */}
					<div className="grid grid-cols-4 gap-2">
						{overview.browsers.length > 0 && (
							<NewBarList
								title="Browsers"
								items={overview.browsers.map(
									(b) => [b.browser, b.count] as [string, number],
								)}
								color="var(--color-sys-accent)"
							/>
						)}
						{overview.operatingSystems.length > 0 && (
							<NewBarList
								title="OS"
								items={overview.operatingSystems.map(
									(o) => [o.os, o.count] as [string, number],
								)}
								color="var(--color-sys-accent)"
							/>
						)}
						{overview.devices.length > 0 && (
							<NewBarList
								title="Devices"
								items={overview.devices.map(
									(d) => [d.device, d.count] as [string, number],
								)}
								color="var(--color-sys-accent)"
							/>
						)}
						{overview.countries.length > 0 && (
							<NewBarList
								title="Countries"
								items={overview.countries.map(
									(c) => [c.country, c.count] as [string, number],
								)}
							/>
						)}
					</div>

					{/* UTM */}
					{(overview.utmSources.length > 0 ||
						overview.utmMediums.length > 0) && (
						<div className="grid grid-cols-3 gap-2">
							{overview.utmSources.length > 0 && (
								<NewBarList
									title="UTM Source"
									items={overview.utmSources.map(
										(u) => [u.source, u.count] as [string, number],
									)}
								/>
							)}
							{overview.utmMediums.length > 0 && (
								<NewBarList
									title="UTM Medium"
									items={overview.utmMediums.map(
										(u) => [u.medium, u.count] as [string, number],
									)}
								/>
							)}
							{overview.utmCampaigns.length > 0 && (
								<NewBarList
									title="UTM Campaign"
									items={overview.utmCampaigns.map(
										(u) => [u.campaign, u.count] as [string, number],
									)}
								/>
							)}
						</div>
					)}

					{/* Top Pages */}
					<div className="bg-sys-surface p-3">
						<div className="mb-2 text-[0.875rem] font-bold uppercase tracking-[0.05em]">
							Top Pages
						</div>
						<table className="w-full text-left text-[0.875rem]">
							<thead>
								<tr>
									<th className="pb-3 pr-4 font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">Path</th>
									<th className="pb-3 px-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">Views</th>
									<th className="pb-3 px-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">Sessions</th>
									<th className="pb-3 px-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">Load</th>
									<th className="pb-3 pl-4 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">Errs</th>
								</tr>
							</thead>
							<tbody className="[&>tr:nth-child(even)]:bg-sys-surface-low">
								{overview.pages.map((p) => (
									<tr
										key={p.path}
										className="group transition-none hover:bg-sys-surface-high"
									>
										<td className="pr-4 py-1.5 font-medium">
											<div className="flex flex-col gap-0.5 min-w-0">
												<span className="font-mono text-[0.75rem] font-bold truncate">
													{p.path}
												</span>
												{p.title && (
													<span className="font-normal opacity-60 text-[0.625rem] truncate">
														{p.title}
													</span>
												)}
											</div>
										</td>
										<td className="px-2 py-1.5 text-right font-mono">{p.views}</td>
										<td className="px-2 py-1.5 text-right font-mono">{p.uniqueSessions}</td>
										<td className="px-2 py-1.5 text-right font-mono opacity-80">{p.averageLoadTimeMs}ms</td>
										<td className={`pl-4 py-1.5 text-right font-mono ${p.errorCount > 0 ? "text-sys-error font-bold" : "opacity-80"}`}>
											{p.errorCount}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* Event Mix */}
					<div className="bg-sys-surface p-3">
						<div className="mb-2 text-[0.875rem] font-bold uppercase tracking-[0.05em]">
							Event Mix
						</div>
						<table className="w-full text-left text-[0.875rem]">
							<thead>
								<tr>
									<th className="pb-3 pr-4 font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">Event</th>
									<th className="pb-3 px-2 font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">Type</th>
									<th className="pb-3 px-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">Total</th>
									<th className="pb-3 pl-4 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">Sessions</th>
								</tr>
							</thead>
							<tbody className="[&>tr:nth-child(even)]:bg-sys-surface-low">
								{overview.events.map((ev) => (
									<tr
										key={`${ev.eventType}-${ev.eventName}`}
										className="group transition-none hover:bg-sys-surface-high"
									>
										<td className="pr-4 py-1.5 font-mono text-[0.75rem] font-bold">{ev.eventName}</td>
										<td className="px-2 py-1.5 opacity-80">{ev.eventType}</td>
										<td className="px-2 py-1.5 text-right font-mono">{ev.totalEvents}</td>
										<td className="pl-4 py-1.5 text-right font-mono">{ev.uniqueSessions}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* Frontend Errors */}
					<div className="bg-sys-surface p-3">
						<div className="mb-2 text-[0.875rem] font-bold uppercase tracking-[0.05em]">
							SYSTEM_HALT
						</div>
						<div className="flex flex-col">
							{overview.frontendErrors.length === 0 ? (
								<p className="py-2 text-[0.875rem] opacity-60">NO SYSTEM HALTS DETECTED.</p>
							) : (
								overview.frontendErrors.map((err) => (
									<div
										key={err.eventId}
										className="flex items-center gap-2 py-1.5 transition-none hover:bg-sys-surface-low border-b border-sys-bg last:border-b-0"
									>
										<span className="block h-[12px] w-[6px] bg-sys-error flex-none" />
										<span className="min-w-0 flex-1 truncate font-mono text-[0.875rem] font-bold text-sys-error">
											{err.errorMessage || err.errorName || "SYSTEM_ERROR"}
										</span>
										<span className="flex-none font-mono text-[0.75rem] opacity-80">{err.pagePath}</span>
										<button
											className="flex-none font-mono text-[0.75rem] text-sys-on-surface underline hover:bg-sys-primary hover:text-white px-2 py-1"
											onClick={() => onNavigate({ tab: 'replay', sessionId: err.sessionId })}
										>
											{err.sessionId.slice(0, 8)}
										</button>
										<span className="flex-none whitespace-nowrap font-mono text-[0.75rem] opacity-60">
											{fmtTs(err.occurredAt)}
										</span>
									</div>
								))
							)}
						</div>
					</div>
				</div>

                {/* Right Area (Sessions Explorer) */}
                <div className="hidden lg:flex flex-1 min-w-[280px] max-w-[400px] flex-col bg-sys-surface min-h-0 h-full">
					<div className="sticky top-0 bg-sys-surface px-3 py-2 flex flex-col gap-1">
						<div className="text-[0.875rem] font-bold uppercase tracking-[0.05em]">Sessions</div>
						<div className="flex flex-wrap gap-1">
							{([
								["all", "All"],
								["ended_in_error", "Errored"],
								["dropoff", "Drop-off"],
								["slow", "Slow"],
							] as Array<[SessionFilter, string]>).map(([key, label]) => (
								<button
									key={key}
									type="button"
									onClick={() => setSessionFilter(key)}
									className={`px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] transition-none cursor-pointer border-[1px] ${
										sessionFilter === key
											? "bg-sys-primary text-white border-sys-primary"
											: "bg-sys-surface-low text-sys-on-surface border-sys-outline hover:bg-sys-surface-high"
									}`}
								>
									{label}
								</button>
							))}
						</div>
					</div>
					<div className="flex flex-col overflow-y-auto [&>button:nth-child(even)]:bg-sys-surface-low">
						{(sessionFilter === "all"
							? overview.recentSessions.map((s) => ({
								...s,
								interactionCount: 0,
								maxLoadTimeMs: null as number | null,
							}))
							: filteredSessions ?? []
						).map((sess) => {
							const badges: Array<{ label: string; className: string }> = [
								{ label: `${sess.eventCount} EV`, className: "bg-sys-surface-high" },
								{ label: `${sess.pageViewCount} PV`, className: "bg-sys-surface-high" },
							];
							if (sess.errorCount > 0)
								badges.push({ label: `${sess.errorCount} ERR`, className: "bg-sys-error text-white" });
							if (sessionFilter === "dropoff" && sess.interactionCount === 0)
								badges.push({ label: "NO INTERACTION", className: "bg-sys-warning text-white" });
							if (sessionFilter === "slow" && sess.maxLoadTimeMs != null)
								badges.push({ label: `${Math.round(sess.maxLoadTimeMs)}MS LOAD`, className: "bg-sys-warning text-white" });
							return (
								<button
									key={sess.sessionId}
									onClick={() => onNavigate({ tab: "replay", sessionId: sess.sessionId })}
									className="w-full text-left p-3 transition-none hover:bg-sys-surface-high group flex flex-col gap-3 relative"
								>
									<div className="absolute left-0 top-0 bottom-0 w-[4px] bg-sys-primary hidden group-hover:block" />
									<div className="flex items-center justify-between">
										<span className="font-mono font-bold text-[0.875rem] truncate max-w-[200px]">{sess.lastPath || "DIRECT"}</span>
										<span className="text-[0.75rem] font-mono opacity-60 group-hover:bg-sys-primary group-hover:text-white group-hover:opacity-100 px-1">
											{sess.sessionId.slice(0, 8)} ➔
										</span>
									</div>
									<div className="flex gap-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] flex-wrap">
										{badges.map((b, i) => (
											<span key={i} className={`${b.className} px-2 py-1`}>{b.label}</span>
										))}
									</div>
								</button>
							);
						})}
						{sessionFilter !== "all" && filteredSessions !== null && filteredSessions.length === 0 && (
							<p className="p-3 text-[0.75rem] opacity-60 uppercase tracking-[0.05em] font-bold">
								No sessions match this filter.
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function Sel({
	value,
	onChange,
	options,
}: {
	value: string;
	onChange: (v: string) => void;
	options: string[][];
}) {
	return (
		<select
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className="h-8 bg-transparent text-[0.875rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface border-b-[2px] border-sys-outline focus:outline-none focus:border-sys-primary transition-none cursor-pointer"
		>
			{options.map(([v, l]) => (
				<option key={v} value={v}>
					{l}
				</option>
			))}
		</select>
	);
}
