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

	if (loading) return <div className="text-[0.875rem] font-bold opacity-60 uppercase tracking-[0.05em] p-3 text-center">LOADING REPLAY VISUAL BUFFER...</div>;
	if (error) return <div className="text-[0.875rem] font-bold uppercase tracking-[0.05em] text-sys-error p-3 text-center border-[2px] border-sys-error bg-sys-error/10">{error.toUpperCase()}</div>;

	return (
		<div className="bg-sys-bg border-[2px] border-sys-outline">
			<div ref={playerRef} className="w-full bg-sys-bg" />
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
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg p-2 font-sans text-sys-on-surface">
			<div className="mb-2 flex items-center justify-between">
                <div>
                    <h1 className="text-[1.2rem] font-medium tracking-tight text-sys-on-surface font-mono m-0 uppercase">SESSION REPLAYS</h1>
                    <p className="text-[0.875rem] text-sys-on-surface opacity-60 font-bold m-0 uppercase tracking-[0.05em] mt-1">VISUAL PLAYBACK AND CHRONOLOGICAL DATA STREAMS.</p>
                </div>
            </div>

            {!selectedSessionId ? (
                <div className="flex-1 flex flex-col items-center justify-center p-2 text-center text-sys-on-surface">
                    <p className="font-bold text-[1rem] font-mono tracking-tight uppercase opacity-60">NO ACTIVE SESSION SELECTED</p>
                    <button 
                        onClick={() => onNavigate({ tab: 'usage' })}
                        className="mt-2 bg-sys-primary text-white px-3 py-2 text-[0.875rem] font-bold uppercase tracking-[0.05em] hover:bg-micro-gradient transition-none cursor-pointer"
                    >
                        GO TO USAGE DASHBOARD
                    </button>
                </div>
            ) : loading ? (
                <div className="flex-1 flex justify-center items-center text-[0.875rem] tracking-[0.05em] font-bold opacity-60">LOADING SESSION TELEMETRY...</div>
            ) : selected ? (
                <div className="flex flex-col gap-2 flex-1 overflow-y-auto">
                    <div className="grid grid-cols-4 gap-2 bg-sys-surface p-3">
                        <div className="flex flex-col justify-center">
                            <span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">SESSION ID</span>
                            <span className="text-[1rem] font-mono tracking-tight truncate">{selected.session.sessionId}</span>
                        </div>
                        <div className="flex flex-col justify-center">
                            <span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">VISITOR ID</span>
                            <span className="text-[1rem] font-mono tracking-tight truncate">{selected.session.visitorId}</span>
                        </div>
                        <div className="flex flex-col justify-center">
                            <span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">FIRST SEEN</span>
                            <span className="text-[1rem] font-mono tracking-tight mt-1">{fmtTs(selected.session.firstSeen)}</span>
                        </div>
                        <div className="flex flex-col justify-center">
                            <span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">LAST SEEN</span>
                            <span className="text-[1rem] font-mono tracking-tight mt-1">{fmtTs(selected.session.lastSeen)}</span>
                        </div>
                    </div>

                    <div className="overflow-hidden bg-sys-surface p-2">
                        <ReplayPlayer 
                            sessionId={selected.session.sessionId} 
                            onTimeUpdate={setPlaybackTime}
                        />
                    </div>

                    <div className="bg-sys-surface overflow-hidden">
                        <div className="bg-sys-surface-low border-b-[2px] border-sys-outline flex items-center justify-between px-3 py-2">
                            <span className="text-[0.875rem] font-bold uppercase tracking-[0.05em]">FULL EVENT STREAM ({combinedTimeline.length} ENTRIES)</span>
                            <button className="text-[0.75rem] font-bold uppercase tracking-[0.05em] hover:text-sys-primary cursor-pointer transition-none underline" onClick={() => copy(JSON.stringify(selected, null, 2))}>
                                COPY JSON
                            </button>
                        </div>
                        <div className="max-h-[600px] overflow-y-auto">
                            {combinedTimeline.map((ev) => {
                                const isActive = ev.eventId === activeEvent;
                                return (
                                <div
                                    key={ev.eventId}
                                    className={`flex items-start gap-2 py-1.5 px-3 border-b-[1px] border-sys-surface-low font-mono text-[0.75rem] transition-none ${
                                        isActive
                                            ? "bg-sys-surface-high border-l-[4px] border-l-sys-primary"
                                            : ev.isTrace ? "hover:bg-sys-surface-high border-l-[4px] border-l-transparent" : "hover:bg-sys-surface-low border-l-[4px] border-l-transparent"
                                    } ${!isActive && ev.severity === "error" ? "bg-sys-error/10 text-sys-error" : ""}`}
                                >
                                    <span className={`w-32 flex-none font-bold py-1 ${
                                        isActive ? "text-sys-primary" : ev.isTrace ? "text-sys-on-surface opacity-80" : "opacity-60"
                                    }`}>
                                        {ev.eventType.toUpperCase()}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <div className="font-bold text-[0.875rem] mb-1">{ev.eventName}</div>
                                        {ev.properties && Object.keys(ev.properties).length > 0 && (
                                            <div className="flex flex-wrap gap-2 opacity-80 mt-2">
                                                {Object.entries(ev.properties).map(([k, v]) => (
                                                    <span key={k} className="bg-sys-bg px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em]">
                                                        {k}: {typeof v === 'string' ? v : JSON.stringify(v)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </span>
                                    <span className="flex-none max-w-[200px] truncate text-right py-1 opacity-60">
                                        {ev.pagePath || "—"}
                                    </span>
                                    <span className="flex-none whitespace-nowrap w-[140px] text-right py-1 opacity-80">
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
