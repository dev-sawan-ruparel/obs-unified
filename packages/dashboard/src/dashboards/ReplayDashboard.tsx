import {
	type PointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "../components/Button";
import {
	ConnectedRail,
	type ConnectedSection,
} from "../components/ConnectedRail";
import { Input } from "../components/forms";
import { useDashboard } from "../provider";
import { ReplayList } from "./replay/ReplayList";
import { ReplayPlayer } from "./replay/ReplayPlayer";
import { ReplayTimeline } from "./replay/ReplayTimeline";
import type {
	ReplayRow,
	ReplayTimelineEntry,
	SessionDetail,
	TimelineGroup,
	TraceEvent,
} from "./replay/types";
import { fmtTs } from "./replay/utils";

export function ReplayDashboard({
	initialSessionId,
	onNavigate,
}: {
	initialSessionId?: string;
	onNavigate: (route: {
		tab?: string;
		sessionId?: string;
		traceId?: string;
	}) => void;
}) {
	const { basePath, fetcher } = useDashboard();
	const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
		initialSessionId ?? null,
	);
	const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(
		null,
	);
	const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);
	const [playbackTime, setPlaybackTime] = useState<number | null>(null);
	const [loading, setLoading] = useState(false);
	// RFC 0004 — interaction groups derived from /internal/timeline. Empty
	// object when the session predates Mode A or has no clicks with
	// interaction_id stamped (informative-absence pattern from RFC 0006).
	const [interactionGroups, setInteractionGroups] = useState<
		Record<string, TimelineGroup>
	>({});

	const [replaysList, setReplaysList] = useState<ReplayRow[]>([]);
	const [loadingList, setLoadingList] = useState(false);

	const [sidebarWidth, setSidebarWidth] = useState(380);
	const [isDragging, setIsDragging] = useState(false);
	const openRequestId = useRef(0);

	useEffect(() => {
		let cancelled = false;
		setLoadingList(true);
		fetcher(`${basePath}/replays`)
			.then((r) => r.json() as Promise<{ replays: ReplayRow[] }>)
			.then((d) => {
				if (!cancelled) setReplaysList(d.replays || []);
			})
			.catch((err) => {
				if (!cancelled) console.error("Error fetching replays:", err);
			})
			.finally(() => {
				if (!cancelled) setLoadingList(false);
			});
		return () => {
			cancelled = true;
		};
	}, [basePath, fetcher]);

	const openSession = useCallback(
		async (id: string) => {
			const requestId = ++openRequestId.current;
			setLoading(true);
			setSelectedSessionId(id);
			setTraceEvents([]);
			setPlaybackTime(null);
			setInteractionGroups({});
			onNavigate({ tab: "replay", sessionId: id });
			try {
				const [detail, tracesObj, timeline] = await Promise.all([
					fetcher(`${basePath}/usage/sessions/${encodeURIComponent(id)}`).then(
						(r) => r.json(),
					) as Promise<SessionDetail>,
					fetcher(
						`${basePath}/telemetry/overview?hours=72&q=${encodeURIComponent(id)}`,
					)
						.then((r) => r.json())
						.catch(() => ({ traces: [] })) as Promise<{ traces: TraceEvent[] }>,
					// RFC 0004 — fetch the timeline so we can render the
					// "interactions in this session" panel with click→trace
					// links. Tolerate failure: older collectors don't ship the
					// groups field, so we render the informative-absence state.
					fetcher(`${basePath}/timeline/${encodeURIComponent(id)}`)
						.then((r) => r.json())
						.catch(() => ({ groups: {} })) as Promise<{
						groups?: Record<string, TimelineGroup>;
					}>,
				]);
				if (requestId === openRequestId.current) {
					setSessionDetail(detail);
					setTraceEvents(tracesObj.traces || []);
					setInteractionGroups(timeline.groups ?? {});
				}
			} catch {
			} finally {
				if (requestId === openRequestId.current) setLoading(false);
			}
		},
		[basePath, fetcher, onNavigate],
	);

	useEffect(() => {
		if (
			initialSessionId &&
			(!sessionDetail || initialSessionId !== selectedSessionId) &&
			!loading
		) {
			openSession(initialSessionId);
		}
	}, [
		initialSessionId,
		selectedSessionId,
		sessionDetail,
		openSession,
		loading,
	]);

	const selected =
		sessionDetail?.session.sessionId === selectedSessionId
			? sessionDetail
			: null;

	const combinedTimeline = useMemo<ReplayTimelineEntry[]>(() => {
		if (!selected) return [];
		const traces = traceEvents.map((t, index) => ({
			eventId: Object.hasOwn(t, "eventId") ? t.eventId : t.traceId,
			timelineKey: `trace:${t.traceId}:${t.startTime}:${index}`,
			eventType: "backend_trace",
			eventName: `${t.spanName} (${t.serviceName})`,
			pagePath: t.statusMessage || `${t.durationMs}ms`,
			severity: t.statusCode === 2 ? "error" : "info",
			occurredAt: t.startTime,
			properties: { traceId: t.traceId, spans: t.spanCount },
			isTrace: true,
			originalTrace: t,
		}));
		const evs = selected.events.map((e, index) => ({
			...e,
			timelineKey: `event:${e.eventId ?? "missing"}:${e.occurredAt}:${index}`,
			isTrace: false,
			originalTrace: null,
		}));
		return [...evs, ...traces].sort(
			(a, b) =>
				new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
		);
	}, [selected, traceEvents]);

	const activeEvent = useMemo(() => {
		if (playbackTime === null) return null;
		for (let i = combinedTimeline.length - 1; i >= 0; i--) {
			if (new Date(combinedTimeline[i].occurredAt).getTime() <= playbackTime) {
				return combinedTimeline[i].timelineKey;
			}
		}
		return null;
	}, [combinedTimeline, playbackTime]);

	const interactionRailSections = useMemo<ConnectedSection[]>(() => {
		const groups = Object.values(interactionGroups);
		if (groups.length === 0) {
			return [
				{
					label: "Interactions in this session",
					links: [],
					emptyReason:
						"No interaction_id stamped on any event in this session.",
				},
			];
		}
		return groups.map((group) => ({
			label: group.clickEvent?.title ?? "Interaction",
			links: group.causedTraces.map((trace) => ({
				label: `${trace.serviceName ?? "unknown"} · ${trace.rootSpanName} · ${trace.durationMs}ms`,
				href: `#/traces/${trace.traceId}`,
				sample: group.interactionId,
			})),
			emptyReason:
				group.causedTraces.length === 0
					? "The click was recorded but no backend trace was ingested with this interaction_id."
					: undefined,
		}));
	}, [interactionGroups]);

	const deleteReplay = async () => {
		if (!selectedSessionId) return;
		if (
			!confirm(
				"Are you sure you want to permanently delete this session replay? This action cannot be undone.",
			)
		)
			return;

		setLoading(true);
		try {
			await fetcher(
				`${basePath}/replays/${encodeURIComponent(selectedSessionId)}`,
				{
					method: "DELETE",
				},
			);
			setReplaysList((prev) =>
				prev.filter((r) => r.session_id !== selectedSessionId),
			);
			setSelectedSessionId(null);
			onNavigate({ tab: "replay" });
		} catch (e) {
			console.error("Failed to delete replay session:", e);
			alert("Failed to delete replay session");
		} finally {
			setLoading(false);
		}
	};

	const handleMouseMove = useCallback(
		(e: PointerEvent) => {
			if (!isDragging) return;
			e.preventDefault();
			const w = Math.max(
				250,
				Math.min(e.clientX - 10, window.innerWidth - 300),
			);
			setSidebarWidth(w);
		},
		[isDragging],
	);

	const handleMouseUp = useCallback(() => {
		if (isDragging) setIsDragging(false);
	}, [isDragging]);

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg p-2 font-sans text-sys-on-surface">
			<div className="mb-2 flex-none flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2">
				<Input
					type="text"
					className="min-w-[200px] flex-1"
					placeholder="Search replays (e.g. users, links)…"
					disabled
				/>
				<Button disabled>Search</Button>
				{selectedSessionId && (
					<div className="ml-auto flex items-center gap-2">
						<Button variant="danger" onClick={deleteReplay}>
							Delete replay
						</Button>
						<Button
							variant="primary"
							onClick={() => {
								setSelectedSessionId(null);
								onNavigate({ tab: "replay" });
							}}
						>
							Clear selection
						</Button>
					</div>
				)}
			</div>

			<div
				className="flex-1 flex overflow-hidden w-full gap-2 relative"
				onPointerMove={handleMouseMove}
				onPointerUp={handleMouseUp}
				onPointerLeave={handleMouseUp}
			>
				<ReplayList
					width={sidebarWidth}
					replays={replaysList}
					loading={loadingList}
					selectedSessionId={selectedSessionId}
					onOpenSession={openSession}
				/>

				{/* Divider / Resizer */}
				<hr
					aria-orientation="vertical"
					aria-valuemin={260}
					aria-valuemax={640}
					aria-valuenow={sidebarWidth}
					tabIndex={0}
					className={`w-2 -mx-[4px] z-10 cursor-col-resize flex-none hover:bg-sys-primary/20 ${isDragging ? "bg-sys-primary/40" : "bg-transparent"} transition-colors`}
					onMouseDown={() => setIsDragging(true)}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft") {
							setSidebarWidth((width) => Math.max(260, width - 20));
						}
						if (event.key === "ArrowRight") {
							setSidebarWidth((width) => Math.min(640, width + 20));
						}
					}}
				/>

				{/* Main Output / Diagram Area */}
				<div
					className={`flex-1 flex flex-col overflow-hidden min-w-0 transition-opacity ${isDragging ? "opacity-90 pointer-events-none" : "opacity-100"}`}
				>
					{!selectedSessionId ? (
						<div className="flex-1 flex flex-col items-center justify-center p-2 text-center text-sys-on-surface bg-sys-surface border-[1px] border-sys-outline">
							<p className="font-semibold text-[1rem] font-mono tracking-tight opacity-60">
								Select a session to replay
							</p>
							<p className="text-[0.875rem] mt-2 opacity-50 max-w-sm">
								Visually observe a user's chronological path through the app,
								with interaction context decoupled from aggregate usage.
							</p>
						</div>
					) : loading ? (
						<div className="flex-1 flex justify-center items-center text-[0.875rem] tracking-[0.05em] font-bold opacity-60 bg-sys-surface border-[1px] border-sys-outline">
							Loading session telemetry...
						</div>
					) : selected ? (
						<div className="flex flex-col gap-2 flex-1 overflow-y-auto">
							<div className="grid grid-cols-4 gap-2 flex-none">
								<div className="flex flex-col justify-center bg-sys-surface px-3 py-2 border-[1px] border-sys-outline">
									<span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">
										SESSION ID
									</span>
									<span className="text-3xl font-light font-mono tracking-tight truncate">
										{selected.session.sessionId}
									</span>
								</div>
								<div className="flex flex-col justify-center bg-sys-surface px-3 py-2 border-[1px] border-sys-outline">
									<span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">
										VISITOR ID
									</span>
									<span className="text-3xl font-light font-mono tracking-tight truncate">
										{selected.session.visitorId}
									</span>
								</div>
								<div className="flex flex-col justify-center bg-sys-surface px-3 py-2 border-[1px] border-sys-outline">
									<span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">
										FIRST SEEN
									</span>
									<span className="text-3xl font-light font-mono tracking-tight mt-1 truncate">
										{fmtTs(selected.session.firstSeen)}
									</span>
								</div>
								<div className="flex flex-col justify-center bg-sys-surface px-3 py-2 border-[1px] border-sys-outline">
									<span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mb-2">
										LAST SEEN
									</span>
									<span className="text-3xl font-light font-mono tracking-tight mt-1 truncate">
										{fmtTs(selected.session.lastSeen)}
									</span>
								</div>
							</div>
							<div className="flex-none bg-sys-surface p-2 border-[1px] border-sys-outline">
								<ReplayPlayer
									sessionId={selected.session.sessionId}
									onTimeUpdate={setPlaybackTime}
								/>
							</div>

							<div className="flex min-h-[420px] flex-none gap-2">
								{/* RFC 0006 — connected rail for the session itself.
								    RFC 0004 click→trace groups are injected as rail
								    related sections so replay has one relationship
								    surface instead of a separate interactions panel. */}
								<ConnectedRail
									entityKind="replay"
									entityId={selected.session.sessionId}
									sessionId={selected.session.sessionId}
									extraRelatedSections={interactionRailSections}
									onNavigate={(href) => {
										const traceId = href.match(/^#\/traces\/(.+)$/)?.[1];
										if (traceId) {
											onNavigate({ tab: "traces", traceId });
										}
									}}
								/>

								<ReplayTimeline
									entries={combinedTimeline}
									activeEvent={activeEvent}
									copyValue={selected}
								/>
							</div>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
