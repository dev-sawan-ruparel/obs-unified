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
		<div className="flex h-full flex-col overflow-hidden bg-slate-50/50 p-2 lg:p-4 font-sans text-slate-900">
			{/* Toolbar */}
			<div className="mb-4 flex-none flex items-center gap-3 rounded-sm bg-white border border-slate-200 px-3 py-1.5 shadow-sm">
				<Sel
					value={hours}
					onChange={(v) => setHours(v)}
					options={[
						["6", "6h"],
						["24", "24h"],
						["72", "72h"],
						["168", "7d"],
						["720", "30d"],
					]}
				/>
				<Sel
					value={pathFilter}
					onChange={setPathFilter}
					options={pathOptions.map((p) => [p, p === "all" ? "All paths" : p])}
				/>
				<label className="flex items-center gap-1.5 text-xs text-stone-700">
					<input
						type="checkbox"
						checked={includeAdmin}
						onChange={(e) => setIncludeAdmin(e.target.checked)}
					/>
					Admin
				</label>
				<div className="ml-auto flex items-center gap-3">
					<div className="flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 border border-slate-100 shadow-sm">
						<span className="relative flex h-2 w-2">
							{connStatus === "connecting" && (
								<>
									<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75"></span>
									<span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-500"></span>
								</>
							)}
							{connStatus === "connected" && (
								<>
									<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
									<span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
								</>
							)}
							{connStatus === "error" && (
								<span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
							)}
						</span>
						<span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
							{connStatus}
						</span>
					</div>
					<span className="text-[10px] whitespace-nowrap font-medium text-slate-400">
						Updated {fmtTs(overview.timestamp)}
					</span>
				</div>
			</div>

			{/* Stats */}
			<div className="mb-4 flex-none overflow-hidden rounded-sm bg-white border border-slate-200">
				<div className="grid grid-cols-7 divide-x divide-slate-100">
					<Stat label="Events" value={s.totalEvents} />
					<Stat label="Sessions" value={s.uniqueSessions} />
					<Stat label="Visitors" value={s.uniqueVisitors} />
					<Stat label="Views" value={s.pageViews} />
					<Stat label="Errors" value={s.frontendErrors} cls="text-red-500 font-semibold" />
					<Stat label="Interactions" value={s.interactions} />
					<Stat label="Bots" value={overview.botsFiltered} cls="text-slate-400" />
				</div>
			</div>

			<div className="flex-1 flex flex-col lg:flex-row gap-4 overflow-hidden pt-1">
                {/* Left Primary Area */}
				<div className="flex-[2.5] flex flex-col gap-4 overflow-y-auto pr-1 pb-10 min-h-0">
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
					<div className="rounded-sm overflow-hidden bg-white border border-slate-200">
						<div className="border-b border-slate-100 bg-slate-50/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
							Top Pages
						</div>
						<table className="w-full text-xs">
							<thead className="bg-white">
								<tr className="border-b border-slate-100">
									<th className="text-left px-4 py-2 font-medium text-slate-400">Path</th>
									<th className="text-right px-4 py-2 font-medium text-slate-400">Views</th>
									<th className="text-right px-4 py-2 font-medium text-slate-400">Sessions</th>
									<th className="text-right px-4 py-2 font-medium text-slate-400">Load</th>
									<th className="text-right px-4 py-2 font-medium text-slate-400">Errs</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-50">
								{overview.pages.map((p) => (
									<tr
										key={p.path}
										className="group transition-colors hover:bg-slate-50/80"
									>
										<td className="px-4 py-2.5 text-slate-900 font-medium">
											{p.path}
											{p.title && <span className="ml-2 font-normal text-slate-400">{p.title}</span>}
										</td>
										<td className="px-4 py-2.5 text-right text-slate-600">{p.views}</td>
										<td className="px-4 py-2.5 text-right text-slate-600">{p.uniqueSessions}</td>
										<td className="px-4 py-2.5 text-right text-slate-400">{p.averageLoadTimeMs}ms</td>
										<td className={`px-4 py-2.5 text-right ${p.errorCount > 0 ? "text-red-500 font-semibold" : "text-slate-400"}`}>
											{p.errorCount}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* Event Mix */}
					<div className="rounded-sm overflow-hidden bg-white border border-slate-200">
						<div className="border-b border-slate-100 bg-slate-50/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
							Event Mix
						</div>
						<table className="w-full text-xs">
							<thead className="bg-white">
								<tr className="border-b border-slate-100">
									<th className="text-left px-4 py-2 font-medium text-slate-400">Event</th>
									<th className="text-left px-4 py-2 font-medium text-slate-400">Type</th>
									<th className="text-right px-4 py-2 font-medium text-slate-400">Total</th>
									<th className="text-right px-4 py-2 font-medium text-slate-400">Sessions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-50">
								{overview.events.map((ev) => (
									<tr
										key={`${ev.eventType}-${ev.eventName}`}
										className="group transition-colors hover:bg-slate-50/80"
									>
										<td className="px-4 py-2.5 font-medium text-slate-900">{ev.eventName}</td>
										<td className="px-4 py-2.5 text-slate-500">{ev.eventType}</td>
										<td className="px-4 py-2.5 text-right text-slate-600">{ev.totalEvents}</td>
										<td className="px-4 py-2.5 text-right text-slate-600">{ev.uniqueSessions}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* Frontend Errors */}
					<div className="rounded-sm overflow-hidden bg-white border border-slate-200">
						<div className="border-b border-slate-100 bg-slate-50/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
							Frontend Errors
						</div>
						<div className="divide-y divide-slate-50">
							{overview.frontendErrors.length === 0 ? (
								<p className="px-4 py-5 text-sm text-slate-400 italic">No errors recorded.</p>
							) : (
								overview.frontendErrors.map((err) => (
									<div
										key={err.eventId}
										className="flex items-center gap-3 px-4 py-3 text-xs transition-colors hover:bg-slate-50/80"
									>
										<div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-red-100">
											<span className="block h-2 w-2 rounded-full bg-red-500" />
										</div>
										<span className="min-w-0 flex-1 truncate font-medium text-slate-900">
											{err.errorMessage || err.errorName || "error"}
										</span>
										<span className="flex-none text-slate-400">{err.pagePath}</span>
										<button
											className="flex-none rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] text-slate-500 hover:border-slate-300 hover:text-slate-900"
											onClick={() => onNavigate({ tab: 'replay', sessionId: err.sessionId })}
										>
											{err.sessionId.slice(0, 10)}
										</button>
										<span className="flex-none whitespace-nowrap text-slate-400">
											{fmtTs(err.occurredAt)}
										</span>
									</div>
								))
							)}
						</div>
					</div>
				</div>

                {/* Right Area (Recent Sessions) */}
                <div className="hidden lg:flex flex-1 min-w-[280px] max-w-[400px] flex-col bg-white rounded-sm border border-slate-200 overflow-hidden min-h-0 h-full">
					<div className="border-b border-slate-100 bg-slate-50/50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 sticky top-0">
						Recent Sessions
					</div>
					<div className="divide-y divide-slate-50 overflow-y-auto">
						{overview.recentSessions.map((sess) => (
							<button
								key={sess.sessionId}
								onClick={() => onNavigate({ tab: 'replay', sessionId: sess.sessionId })}
								className="w-full text-left p-3 transition-colors hover:bg-slate-50/80 group flex flex-col gap-1.5"
							>
								<div className="flex items-center justify-between">
                                    <span className="font-medium text-slate-900 text-xs truncate max-w-[200px]">
                                        {sess.lastPath || "Direct"}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-mono group-hover:text-slate-600 transition-colors">
                                        {sess.sessionId.slice(0, 8)} ➔
                                    </span>
                                </div>
								<div className="flex gap-2 text-[10px] text-slate-500">
									<span className="bg-slate-100 px-1.5 py-0.5 rounded">{sess.eventCount} ev</span>
                                    <span className="bg-slate-100 px-1.5 py-0.5 rounded">{sess.pageViewCount} pv</span>
                                    {sess.errorCount > 0 && <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-medium">{sess.errorCount} err</span>}
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
		<div className="flex flex-col justify-center px-4 py-2 bg-white transition-colors hover:bg-slate-50">
			<p className="m-0 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
				{label}
			</p>
			<p className={`m-0 mt-1 text-2xl font-light tracking-tight ${cls ?? "text-slate-900"}`}>
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
		<div className="rounded-sm bg-white p-3 border border-slate-200 transition-all hover:border-slate-300">
			<p className="m-0 mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
				{title}
			</p>
			<div className="space-y-3">
				{items.map(([label, value]) => (
					<div key={label} className="group">
						<div className="flex justify-between font-sans text-xs font-medium text-slate-700">
							<span className="truncate pr-2">{label}</span>
							<span className="text-slate-400 transition-colors group-hover:text-slate-900">{value}</span>
						</div>
						<div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
							<div
								className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out"
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
		<div className="rounded-sm bg-white p-3 border border-slate-200 transition-all hover:border-slate-300">
			<p className="m-0 mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
				Page Views Over Time
			</p>
			<div className="flex h-20 items-end gap-0.5">
				{data.map((d) => (
					<div
						key={d.hour}
						className="group relative flex-1 min-w-[2px]"
						title={`${new Date(d.hour).toLocaleString()}: ${d.count}`}
					>
						<div
							className="w-full rounded-t bg-blue-400/80 transition-all duration-300 group-hover:bg-blue-600"
							style={{ height: `${Math.max(4, (d.count / max) * 80)}px` }}
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
			className="h-7 rounded border border-stone-300 bg-white px-1.5 text-xs text-stone-700 focus:outline-none"
		>
			{options.map(([v, l]) => (
				<option key={v} value={v}>
					{l}
				</option>
			))}
		</select>
	);
}
