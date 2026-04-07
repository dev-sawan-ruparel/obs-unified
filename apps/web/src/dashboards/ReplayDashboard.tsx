import { useEffect, useMemo, useRef, useState } from "react";
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";

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

function ReplayPlayer({ 
	sessionId, 
	onTimeUpdate 
}: { 
	sessionId: string,
	onTimeUpdate?: (timeValue: number) => void 
}) {
	const [events, setEvents] = useState<any[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const playerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setLoading(true);
		setError("");
		setEvents(null);

		fetch(`/api/admin/usage/replays/${encodeURIComponent(sessionId)}`)
			.then((r) => {
				if (!r.ok) throw new Error("Replay not found or error loading");
				return r.json();
			})
			.then((data) => {
				if (data && data.events && data.events.length > 2) {
					setEvents(data.events);
				} else {
					setError("No visual replay data available for this session.");
				}
			})
			.catch((e) => setError(e.message))
			.finally(() => setLoading(false));
	}, [sessionId]);

	useEffect(() => {
		if (events && playerRef.current) {
			playerRef.current.innerHTML = "";
			const player = new rrwebPlayer({
				target: playerRef.current,
				props: {
					events,
					autoPlay: true,
					width: playerRef.current.clientWidth,
				},
			});
			if (onTimeUpdate) {
				player.addEventListener('ui-update-current-time', (e: any) => {
					const offset = e?.payload ?? e?.detail;
					if (typeof offset === 'number' && events[0]?.timestamp) {
						onTimeUpdate(events[0].timestamp + offset);
					}
				});
			}
			return () => {
				try { player.pause(); } catch {}
			};
		}
	}, [events]);

	if (loading) return <div className="text-sm text-slate-400 font-medium p-4">Loading replay visual buffer...</div>;
	if (error) return <div className="text-sm text-red-400 font-medium p-4">{error}</div>;

	return (
		<div className="rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-900/5">
			<div ref={playerRef} className="w-full bg-slate-50" />
		</div>
	);
}

export function ReplayDashboard({ initialSessionId, onNavigate }: { initialSessionId?: string, onNavigate: (route: { tab?: string; sessionId?: string }) => void }) {
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialSessionId ?? null);
	const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
	const [traceEvents, setTraceEvents] = useState<any[]>([]);
	const [playbackTime, setPlaybackTime] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);

	const openSession = async (id: string) => {
		setLoading(true);
		setSelectedSessionId(id);
		setTraceEvents([]);
		setPlaybackTime(null);
		onNavigate({ tab: "replay", sessionId: id });
		try {
			const [detail, tracesObj] = await Promise.all([
				api<SessionDetail>(`/api/admin/usage/sessions/${encodeURIComponent(id)}`),
				api<any>(`/api/admin/telemetry?hours=72&q=${encodeURIComponent(id)}`).catch(() => ({ traces: [] }))
			]);
			setSessionDetail(detail);
			setTraceEvents(tracesObj.traces || []);
		} catch {
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (initialSessionId && (!sessionDetail || initialSessionId !== selectedSessionId) && !loading) {
			openSession(initialSessionId);
		}
	}, [initialSessionId]);

	const selected = sessionDetail?.session.sessionId === selectedSessionId ? sessionDetail : null;

	const combinedTimeline = useMemo(() => {
		if (!selected) return [];
		const traces = traceEvents.map(t => ({
			eventId: Object.hasOwn(t, 'eventId') ? t.eventId : t.traceId,
			eventType: 'backend_trace',
			eventName: `${t.spanName} (${t.serviceName})`,
			pagePath: t.statusMessage || `${t.durationMs}ms`,
			severity: t.statusCode === 2 ? 'error' : 'info',
			occurredAt: t.startTime,
			properties: { traceId: t.traceId, spans: t.spanCount },
			isTrace: true,
			originalTrace: t
		}));
		const evs = selected.events.map(e => ({ ...e, isTrace: false, originalTrace: null }));
		return [...evs, ...traces].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
	}, [selected, traceEvents]);

	const activeEvent = useMemo(() => {
		if (playbackTime === null) return null;
		for (let i = combinedTimeline.length - 1; i >= 0; i--) {
			if (new Date(combinedTimeline[i].occurredAt).getTime() <= playbackTime) {
				return combinedTimeline[i].eventId;
			}
		}
		return null;
	}, [combinedTimeline, playbackTime]);

	return (
		<div className="flex h-full flex-col overflow-hidden bg-slate-50/50 p-6 font-sans text-slate-900">
			<div className="mb-4 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold tracking-tight text-slate-900">Session Replays</h1>
                    <p className="text-sm text-slate-500">Visual playback and chronological data streams.</p>
                </div>
            </div>

            {!selectedSessionId ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                    <svg className="h-12 w-12 text-slate-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="font-semibold text-slate-700 text-lg">No active session selected</p>
                    <p className="text-sm mt-1 mb-6 max-w-sm text-slate-400">Select an interesting session from the Usage overview or tracing diagnostics to view a pixel-perfect playback.</p>
                    <button 
                        onClick={() => onNavigate({ tab: 'usage' })}
                        className="rounded-md bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
                    >
                        Go to Usage Dashboard
                    </button>
                </div>
            ) : loading ? (
                <div className="flex-1 flex justify-center items-center text-slate-400">Loading session telemetry...</div>
            ) : selected ? (
                <div className="flex flex-col gap-6 flex-1 overflow-y-auto pr-2 pb-10">
                    <div className="grid grid-cols-4 gap-4 bg-white p-4 rounded-xl shadow-sm ring-1 ring-slate-900/5">
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Session ID</span>
                            <span className="text-xs font-mono text-slate-800 truncate mt-1">{selected.session.sessionId}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Visitor ID</span>
                            <span className="text-xs font-mono text-slate-800 truncate mt-1">{selected.session.visitorId}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">First Seen</span>
                            <span className="text-xs font-mono text-slate-800 mt-1">{fmtTs(selected.session.firstSeen)}</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Last Seen</span>
                            <span className="text-xs font-mono text-slate-800 mt-1">{fmtTs(selected.session.lastSeen)}</span>
                        </div>
                    </div>

                    <div className="rounded-xl overflow-hidden shadow-xl ring-1 ring-slate-900/10">
                        <ReplayPlayer 
                            sessionId={selected.session.sessionId} 
                            onTimeUpdate={setPlaybackTime}
                        />
                    </div>

                    <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-900/5 overflow-hidden">
                        <div className="bg-slate-50/80 border-b border-slate-100 flex items-center justify-between px-5 py-3">
                            <span className="text-sm font-semibold text-slate-700 tracking-tight">Full Event Stream ({combinedTimeline.length} entries)</span>
                            <button className="text-[10px] font-medium text-slate-500 hover:text-slate-900 uppercase tracking-wider" onClick={() => copy(JSON.stringify(selected, null, 2))}>
                                Copy JSON
                            </button>
                        </div>
                        <div className="divide-y divide-slate-50 max-h-[600px] overflow-y-auto p-1">
                            {combinedTimeline.map((ev) => {
                                const isActive = ev.eventId === activeEvent;
                                return (
                                <div
                                    key={ev.eventId}
                                    className={`flex items-start gap-4 py-2 px-3 m-1 rounded-md font-mono text-xs transition-colors ${
                                        isActive
                                            ? "bg-blue-100 shadow-inner"
                                            : ev.isTrace ? "bg-indigo-50/40 hover:bg-indigo-50/70" : "hover:bg-slate-50"
                                    } ${!isActive && ev.severity === "error" ? "bg-red-50/40 text-red-900" : ""}`}
                                >
                                    <span className={`w-24 flex-none uppercase tracking-wide text-[9px] font-bold py-1 ${
                                        isActive ? "text-blue-600" : ev.isTrace ? "text-indigo-500" : "text-slate-400"
                                    }`}>
                                        {ev.eventType}
                                    </span>
                                    <span className="min-w-0 flex-1 text-slate-800">
                                        <div className="font-semibold text-[11px] mt-0.5">{ev.eventName}</div>
                                        {ev.properties && Object.keys(ev.properties).length > 0 && (
                                            <div className="mt-1.5 flex flex-wrap gap-1.5 opacity-90">
                                                {Object.entries(ev.properties).map(([k, v]) => (
                                                    <span key={k} className="rounded bg-white px-1.5 py-0.5 text-[9px] tracking-wide text-slate-600 border border-slate-200/60 shadow-sm">
                                                        {k}: {typeof v === 'string' ? v : JSON.stringify(v)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </span>
                                    <span className="flex-none text-slate-500 max-w-[150px] truncate text-right py-1 tracking-tight">
                                        {ev.pagePath || "—"}
                                    </span>
                                    <span className="flex-none whitespace-nowrap text-slate-400 w-[120px] text-right py-1 font-medium">
                                        {fmtTs(ev.occurredAt)}
                                    </span>
                                </div>
                            )})}
                        </div>
                    </div>
                </div>
            ) : null}
		</div>
	);
}
