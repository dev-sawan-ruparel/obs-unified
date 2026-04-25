import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";
import { useDashboard } from "../provider";

const fmtTs = (iso: string) => {
	try {
		const d = new Date(iso);
		return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
	} catch {
		return iso;
	}
};

const fmtDur = (start: string, end: string) => {
	try {
        const ms = new Date(end).getTime() - new Date(start).getTime();
        if (ms < 1000) return `${ms}ms`;
        const s = Math.floor(ms / 1000);
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        return `${m}m ${s % 60}s`;
    } catch {
        return "—";
    }
}

const copy = (t: string) => {
	void navigator.clipboard.writeText(t);
};

// api helper is now provided via useDashboard context

interface ReplayRow {
	session_id: string;
	visitor_id: string;
	first_chunk_at: string;
	last_chunk_at: string;
	chunk_count: number;
	events_count: number;
	starting_link?: string;
	storage_bytes?: number;
}

const fmtBytes = (bytes: number) => {
	if (!bytes) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

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
	const { basePath, fetcher } = useDashboard();
	const [events, setEvents] = useState<any[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const playerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setLoading(true);
		setError("");
		setEvents(null);

		fetcher(`${basePath}/replays/${encodeURIComponent(sessionId)}`)
			.then((r) => {
				if (!r.ok) throw new Error("Replay not found or error loading");
				return r.json() as Promise<{ events?: any[] }>;
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
	const { basePath, fetcher } = useDashboard();
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initialSessionId ?? null);
	const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
	const [traceEvents, setTraceEvents] = useState<any[]>([]);
	const [playbackTime, setPlaybackTime] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);

	const [replaysList, setReplaysList] = useState<ReplayRow[]>([]);
	const [loadingList, setLoadingList] = useState(false);

	const [sidebarWidth, setSidebarWidth] = useState(380);
	const [isDragging, setIsDragging] = useState(false);

	useEffect(() => {
		setLoadingList(true);
		fetcher(`${basePath}/replays`).then(r => r.json() as Promise<{ replays: ReplayRow[] }>)
			.then((d) => setReplaysList(d.replays || []))
			.catch(err => console.error("Error fetching replays:", err))
			.finally(() => setLoadingList(false));
	}, [basePath, fetcher]);

	const openSession = async (id: string) => {
		setLoading(true);
		setSelectedSessionId(id);
		setTraceEvents([]);
		setPlaybackTime(null);
		onNavigate({ tab: "replay", sessionId: id });
		try {
			const [detail, tracesObj] = await Promise.all([
				fetcher(`${basePath}/usage/sessions/${encodeURIComponent(id)}`).then(r => r.json()) as Promise<SessionDetail>,
				fetcher(`${basePath}/telemetry/overview?hours=72&q=${encodeURIComponent(id)}`).then(r => r.json()).catch(() => ({ traces: [] })) as Promise<{ traces: any[] }>
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

	const deleteReplay = async () => {
		if (!selectedSessionId) return;
		if (!confirm("Are you sure you want to permanently delete this session replay? This action cannot be undone.")) return;
		
		setLoading(true);
		try {
			await fetcher(`${basePath}/replays/${encodeURIComponent(selectedSessionId)}`, {
				method: "DELETE"
			});
			setReplaysList(prev => prev.filter(r => r.session_id !== selectedSessionId));
			setSelectedSessionId(null);
			onNavigate({ tab: "replay" });
		} catch (e) {
			console.error("Failed to delete replay session:", e);
			alert("Failed to delete replay session");
		} finally {
			setLoading(false);
		}
	};

	const handleMouseMove = useCallback((e: React.MouseEvent) => {
		if (!isDragging) return;
		e.preventDefault();
		const w = Math.max(250, Math.min(e.clientX - 10, window.innerWidth - 300));
		setSidebarWidth(w);
	}, [isDragging]);

	const handleMouseUp = useCallback(() => {
		if (isDragging) setIsDragging(false);
	}, [isDragging]);

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg p-2 font-sans text-sys-on-surface"
			 onMouseMove={handleMouseMove}
			 onMouseUp={handleMouseUp}
			 onMouseLeave={handleMouseUp}
		>
			<div className="mb-2 flex-none flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2">
				<input
					type="text"
					className="h-8 min-w-[200px] flex-1 border-b-[2px] border-sys-outline bg-transparent px-2 font-mono text-[0.875rem] font-bold placeholder:opacity-40 focus:border-sys-primary focus:outline-none transition-none"
					placeholder="SEARCH REPLAYS (e.g. users, links)..."
					disabled
				/>
				<button className="px-3 py-1.5 text-[0.875rem] font-bold uppercase tracking-[0.05em] bg-transparent text-sys-on-surface-muted outline outline-[1px] outline-sys-outline hover:bg-sys-surface-low hover:text-sys-on-surface transition-none cursor-not-allowed">
					SEARCH
				</button>
				{selectedSessionId && (
                    <div className="ml-auto flex items-center gap-2">
                        <button
                            className="px-3 py-1.5 text-[0.875rem] font-bold uppercase tracking-[0.05em] bg-sys-error text-white hover:bg-sys-error/80 transition-none cursor-pointer"
                            onClick={deleteReplay}
                        >
                            DELETE REPLAY
                        </button>
                        <button
                            className="px-3 py-1.5 text-[0.875rem] font-bold uppercase tracking-[0.05em] bg-sys-primary text-white hover:bg-micro-gradient transition-none cursor-pointer"
                            onClick={() => {
                                setSelectedSessionId(null);
                                onNavigate({ tab: "replay" });
                            }}
                        >
                            CLEAR SELECTION
                        </button>
                    </div>
				)}
			</div>

			<div className="flex-1 flex overflow-hidden w-full gap-2 relative">
				
				{/* Left Sidebar Menu */}
				<div style={{ width: sidebarWidth }} className="flex-none bg-sys-surface flex flex-col h-full overflow-hidden border-[1px] border-sys-outline select-none">
					<div className="flex-none p-3 border-b-[2px] border-sys-outline flex justify-between items-center">
						<span className="text-[0.875rem] font-bold uppercase tracking-[0.05em]">LATEST REPLAYS</span>
						<span className="text-[0.625rem] font-mono opacity-60 font-bold bg-sys-bg px-2 py-0.5">{replaysList.length} SESSIONS</span>
					</div>
					<div className="flex-1 overflow-y-auto cursor-default">
						{loadingList && <div className="p-4 text-[0.75rem] uppercase font-bold tracking-[0.05em] opacity-60 text-center">LOADING REPLAYS...</div>}
						{!loadingList && replaysList.length === 0 && <div className="p-4 text-[0.75rem] uppercase font-bold tracking-[0.05em] opacity-60 text-center">NO REPLAYS FOUND</div>}
						{replaysList.map((r) => {
							const active = r.session_id === selectedSessionId;
							return (
								<div 
									key={r.session_id}
									onClick={() => openSession(r.session_id)}
									className={`p-3 border-b-[1px] border-sys-outline transition-none cursor-pointer group hover:bg-sys-surface-low block ${active ? "bg-sys-surface-high border-l-[4px] border-l-sys-primary" : "border-l-[4px] border-l-transparent"}`}
								>
									<div className="flex items-center justify-between mb-1.5">
										<span className={`text-[0.75rem] font-bold font-mono truncate mr-2 ${active ? "text-sys-primary" : ""}`}>{r.visitor_id.substring(0, 16)}</span>
										<span className="text-[0.625rem] font-bold opacity-60 whitespace-nowrap">{fmtDur(r.first_chunk_at, r.last_chunk_at)}</span>
									</div>
									<div className="text-[0.875rem] font-bold truncate opacity-90 mb-1 leading-snug">
										{r.starting_link || "Unknown Path"}
									</div>
									<div className="flex items-center justify-between">
										<span className="text-[0.625rem] bg-sys-bg px-1.5 py-0.5 border border-sys-outline opacity-80">{r.events_count} EVENTS</span>
										<span className="text-[0.625rem] bg-sys-bg px-1.5 py-0.5 border border-sys-outline opacity-80">{fmtBytes(r.storage_bytes || (r.events_count ? r.events_count * 65 : 0))}</span>
										<span className="text-[0.625rem] opacity-50 font-mono tracking-tighter truncate">{fmtTs(r.first_chunk_at)}</span>
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{/* Divider / Resizer */}
				<div
					className={`w-2 -mx-[4px] z-10 cursor-col-resize flex-none hover:bg-sys-primary/20 ${isDragging ? "bg-sys-primary/40" : "bg-transparent"} transition-colors`}
					onMouseDown={() => setIsDragging(true)}
				/>

				{/* Main Output / Diagram Area */}
				<div 
					className={`flex-1 flex flex-col overflow-hidden min-w-0 transition-opacity ${isDragging ? "opacity-90 pointer-events-none" : "opacity-100"}`}
				>
					{!selectedSessionId ? (
						<div className="flex-1 flex flex-col items-center justify-center p-2 text-center text-sys-on-surface bg-sys-surface border-[1px] border-sys-outline">
							<p className="font-bold text-[1rem] font-mono tracking-tight uppercase opacity-60">SELECT A SESSION TO REPLAY</p>
							<p className="text-[0.875rem] mt-2 opacity-50 max-w-sm">Replays allow you to visually observe a user's chronological path and interaction context decoupled from generic aggregate usages.</p>
						</div>
					) : loading ? (
						<div className="flex-1 flex justify-center items-center text-[0.875rem] tracking-[0.05em] font-bold opacity-60 bg-sys-surface border-[1px] border-sys-outline">LOADING SESSION TELEMETRY...</div>
					) : selected ? (
						<div className="flex flex-col gap-2 flex-1 overflow-y-auto">
							<div className="grid grid-cols-4 gap-2 flex-none">
								<div className="flex flex-col justify-center bg-sys-surface px-3 py-2 border-[1px] border-sys-outline">
									<span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">SESSION ID</span>
									<span className="text-3xl font-light font-mono tracking-tight truncate">{selected.session.sessionId}</span>
								</div>
								<div className="flex flex-col justify-center bg-sys-surface px-3 py-2 border-[1px] border-sys-outline">
									<span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">VISITOR ID</span>
									<span className="text-3xl font-light font-mono tracking-tight truncate">{selected.session.visitorId}</span>
								</div>
								<div className="flex flex-col justify-center bg-sys-surface px-3 py-2 border-[1px] border-sys-outline">
									<span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">FIRST SEEN</span>
									<span className="text-3xl font-light font-mono tracking-tight mt-1 truncate">{fmtTs(selected.session.firstSeen)}</span>
								</div>
								<div className="flex flex-col justify-center bg-sys-surface px-3 py-2 border-[1px] border-sys-outline">
									<span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">LAST SEEN</span>
									<span className="text-3xl font-light font-mono tracking-tight mt-1 truncate">{fmtTs(selected.session.lastSeen)}</span>
								</div>
							</div>
							<div className="flex-none bg-sys-surface p-2 border-[1px] border-sys-outline">
								<ReplayPlayer 
									sessionId={selected.session.sessionId} 
									onTimeUpdate={setPlaybackTime}
								/>
							</div>

							<div className="bg-sys-surface flex-1 flex flex-col min-h-0 border-[1px] border-sys-outline">
								<div className="bg-sys-surface-low border-b-[2px] border-sys-outline flex items-center justify-between px-3 py-2">
									<span className="text-[0.875rem] font-bold uppercase tracking-[0.05em]">FULL EVENT STREAM ({combinedTimeline.length} ENTRIES)</span>
									<button className="text-[0.75rem] font-bold uppercase tracking-[0.05em] hover:text-sys-primary cursor-pointer transition-none underline" onClick={() => copy(JSON.stringify(selected, null, 2))}>
										COPY JSON
									</button>
								</div>
								<div className="flex-1 overflow-y-auto pb-4">
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

			</div>
		</div>
	);
}

