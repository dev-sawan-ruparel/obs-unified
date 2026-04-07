import { useCallback, useEffect, useMemo, useState } from "react";

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

async function api<T>(path: string): Promise<T> {
	const r = await fetch(path);
	if (!r.ok) throw new Error(`${r.status}`);
	return r.json();
}

interface Props {
	onNavigate: (route: { tab?: string; sessionId?: string }) => void;
}

export function UsageDashboard({ onNavigate }: Props) {
	const [overview, setOverview] = useState<UsageOverview | null>(null);
	const [loading, setLoading] = useState(true);
	const [connStatus, setConnStatus] = useState<"connecting" | "connected" | "error">("connecting");
	const [hours, setHours] = useState("72");
	const [pathFilter, setPathFilter] = useState("all");
	const [includeAdmin, setIncludeAdmin] = useState(false);

	const [leftWidth, setLeftWidth] = useState(60);

	useEffect(() => {
		setLoading(true);
		setConnStatus("connecting");
		const filterParams = new URLSearchParams();
		filterParams.set("hours", hours);
		if (pathFilter !== "all") filterParams.set("path", pathFilter);
		filterParams.set("includeAdmin", includeAdmin ? "true" : "false");

		const sse = new EventSource(`/api/admin/usage/stream?${filterParams.toString()}`, {
			withCredentials: true
		});

		sse.addEventListener("usage-update", (e: any) => {
			try {
				const data = JSON.parse(e.data);
				setOverview(data);
				setLoading(false);
				setConnStatus("connected");
			} catch (err) {
				console.error(err);
			}
		});

		sse.addEventListener("error", () => {
			setConnStatus("error");
		});

		sse.addEventListener("open", () => {
			setConnStatus("connected");
		});

		return () => {
			sse.close();
		};
	}, [hours, pathFilter, includeAdmin]);

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
			<div className="mb-2 flex-none flex items-center gap-2 bg-sys-surface px-3 py-2">
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
				<div className="ml-auto flex items-center gap-2">
					<div className="flex items-center gap-2 bg-sys-surface-low px-3 py-1">
						<span className={`block h-[8px] w-[8px] ${connStatus === 'connected' ? 'bg-sys-primary' : connStatus === 'error' ? 'bg-sys-error' : 'bg-sys-outline'}`} />
						<span className="text-[0.625rem] font-bold uppercase tracking-[0.05em]">
							{connStatus}
						</span>
					</div>
					<span className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">
						UPDATED {fmtTs(overview.timestamp)}
					</span>
				</div>
			</div>

			{/* Stats */}
			<div className="mb-2 flex-none bg-sys-surface px-3 py-2">
				<div className="flex flex-wrap gap-12 gap-y-6">
					<Stat label="Events" value={s.totalEvents} />
					<Stat label="Sessions" value={s.uniqueSessions} />
					<Stat label="Visitors" value={s.uniqueVisitors} />
					<Stat label="Views" value={s.pageViews} />
					<Stat label="Errors" value={s.frontendErrors} cls="text-sys-error" />
					<Stat label="Interactions" value={s.interactions} />
					<Stat label="Bots" value={overview.botsFiltered} cls="opacity-60" />
				</div>
			</div>

			<div className="flex-1 flex flex-col lg:flex-row gap-2 overflow-hidden">
                {/* Left Primary Area */}
				<div className="flex-[2.5] flex flex-col gap-2 overflow-y-auto pr-2 pb-10 min-h-0">
					{/* Sparkline */}
					{overview.hourlyPageViews.length > 0 && (
						<Sparkline data={overview.hourlyPageViews} />
					)}

					{/* Breakdowns row */}
					<div className="grid grid-cols-4 gap-2">
						{overview.browsers.length > 0 && (
							<BarList
								title="Browsers"
								items={overview.browsers.map((b) => [b.browser, b.count])}
							/>
						)}
						{overview.operatingSystems.length > 0 && (
							<BarList
								title="OS"
								items={overview.operatingSystems.map((o) => [o.os, o.count])}
							/>
						)}
						{overview.devices.length > 0 && (
							<BarList
								title="Devices"
								items={overview.devices.map((d) => [d.device, d.count])}
							/>
						)}
						{overview.countries.length > 0 && (
							<BarList
								title="Countries"
								items={overview.countries.map((c) => [c.country, c.count])}
							/>
						)}
					</div>

					{/* UTM */}
					{(overview.utmSources.length > 0 ||
						overview.utmMediums.length > 0) && (
						<div className="grid grid-cols-3 gap-2">
							{overview.utmSources.length > 0 && (
								<BarList
									title="UTM Source"
									items={overview.utmSources.map((u) => [u.source, u.count])}
								/>
							)}
							{overview.utmMediums.length > 0 && (
								<BarList
									title="UTM Medium"
									items={overview.utmMediums.map((u) => [u.medium, u.count])}
								/>
							)}
							{overview.utmCampaigns.length > 0 && (
								<BarList
									title="UTM Campaign"
									items={overview.utmCampaigns.map((u) => [
										u.campaign,
										u.count,
									])}
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
											{p.path}
											{p.title && <span className="ml-3 font-normal opacity-60 text-[0.75rem]">{p.title}</span>}
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

                {/* Right Area (Recent Sessions) */}
                <div className="hidden lg:flex flex-1 min-w-[280px] max-w-[400px] flex-col bg-sys-surface min-h-0 h-full">
					<div className="px-3 py-2 text-[0.875rem] font-bold uppercase tracking-[0.05em] sticky top-0 bg-sys-surface">
						Recent Sessions
					</div>
					<div className="flex flex-col overflow-y-auto [&>button:nth-child(even)]:bg-sys-surface-low">
						{overview.recentSessions.map((sess) => (
							<button
								key={sess.sessionId}
								onClick={() => onNavigate({ tab: 'replay', sessionId: sess.sessionId })}
								className="w-full text-left p-3 transition-none hover:bg-sys-surface-high group flex flex-col gap-3 relative"
							>
								{/* The Local-First Indicator */}
								<div className="absolute left-0 top-0 bottom-0 w-[4px] bg-sys-primary hidden group-hover:block" />
								
								<div className="flex items-center justify-between">
                                    <span className="font-mono font-bold text-[0.875rem] truncate max-w-[200px]">
                                        {sess.lastPath || "DIRECT"}
                                    </span>
                                    <span className="text-[0.75rem] font-mono opacity-60 group-hover:bg-sys-primary group-hover:text-white group-hover:opacity-100 px-1">
                                        {sess.sessionId.slice(0, 8)} ➔
                                    </span>
                                </div>
								<div className="flex gap-3 text-[0.625rem] font-bold uppercase tracking-[0.05em]">
									<span className="bg-sys-surface-high px-2 py-1">{sess.eventCount} EV</span>
                                    <span className="bg-sys-surface-high px-2 py-1">{sess.pageViewCount} PV</span>
                                    {sess.errorCount > 0 && <span className="bg-sys-error text-white px-2 py-1">{sess.errorCount} ERR</span>}
								</div>
							</button>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

function Stat({
	label,
	value,
	cls,
}: {
	label: string;
	value: number;
	cls?: string;
}) {
	return (
		<div className="flex flex-col justify-center">
			<p className="m-0 mb-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">
				{label}
			</p>
			<p className={`m-0 font-mono text-3xl font-light tracking-tight ${cls ?? ""}`}>
				{value}
			</p>
		</div>
	);
}

function BarList({
	title,
	items,
}: {
	title: string;
	items: [string, number][];
}) {
	const max = Math.max(...items.map(([, v]) => v), 1);
	return (
		<div className="bg-sys-surface p-2">
			<p className="m-0 mb-2 text-[0.75rem] font-bold uppercase tracking-[0.05em]">
				{title}
			</p>
			<div className="space-y-4">
				{items.map(([label, value]) => (
					<div key={label} className="group">
						<div className="flex justify-between text-[0.75rem] font-bold mb-1.5">
							<span className="truncate pr-2">{label}</span>
							<span className="font-mono opacity-80">{value}</span>
						</div>
						<div className="h-[4px] w-full bg-sys-surface-low">
							<div
								className="h-full bg-sys-primary transition-all duration-0"
								style={{ width: `${(value / max) * 100}%` }}
							/>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function Sparkline({ data }: { data: Array<{ hour: string; count: number }> }) {
	const max = Math.max(...data.map((d) => d.count), 1);
	return (
		<div className="bg-sys-surface p-3">
			<p className="m-0 mb-2 text-[0.875rem] font-bold uppercase tracking-[0.05em]">
				Page Views Over Time
			</p>
			<div className="flex h-24 items-end gap-[1px]">
				{data.map((d) => (
					<div
						key={d.hour}
						className="group relative flex-1 min-w-[2px]"
						title={`${new Date(d.hour).toLocaleString()}: ${d.count}`}
					>
						<div
							className="w-full bg-sys-primary opacity-50 group-hover:opacity-100 transition-none"
							style={{ height: `${Math.max(2, (d.count / max) * 96)}px` }}
						/>
					</div>
				))}
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
