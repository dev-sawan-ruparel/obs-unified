import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Input, Select } from "../components/forms";
import {
	Card,
	JsonBlock,
	SectionTitle,
	UpdatedChip,
} from "../components/primitives";
import { StateRow } from "../components/states";
import { useApi } from "../use-api";

type Kind = "span" | "log" | "usage";

interface TimelineEvent {
	t: string;
	kind: Kind;
	id: string;
	title: string;
	subtitle?: string;
	severity?: "info" | "warn" | "error";
	durationMs?: number;
	payload: Record<string, unknown>;
}

interface TimelineResponse {
	sessionId: string;
	firstSeen: string | null;
	lastSeen: string | null;
	counts: { spans: number; logs: number; usage: number };
	replay: {
		firstChunkAt: string;
		lastChunkAt: string;
		chunkCount: number;
		eventsCount: number;
	} | null;
	events: TimelineEvent[];
	timestamp: string;
}

interface RecentSession {
	sessionId: string;
	visitorId: string;
	firstSeen: string;
	lastSeen: string;
	eventCount: number;
	pageViewCount: number;
	errorCount: number;
	lastPath: string | null;
}

interface RecentSessionsResponse {
	sessions: RecentSession[];
}

const fmtRelative = (iso: string): string => {
	try {
		const ms = Date.now() - new Date(iso).getTime();
		if (ms < 60_000) return "just now";
		const m = Math.floor(ms / 60_000);
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		return `${Math.floor(h / 24)}d ago`;
	} catch {
		return "";
	}
};

interface Props {
	initialSessionId?: string;
	onNavigate: (route: { tab?: string; sessionId?: string }) => void;
}

const KIND_COLOR: Record<Kind, string> = {
	span: "var(--color-sys-primary)",
	log: "var(--color-sys-accent)",
	usage: "var(--color-sys-outline)",
};

const KIND_LABEL: Record<Kind, string> = {
	span: "Spans",
	log: "Logs",
	usage: "Usage",
};

const fmtTs = (iso: string) => {
	try {
		const d = new Date(iso);
		return d.toLocaleTimeString(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			fractionalSecondDigits: 3,
		});
	} catch {
		return iso;
	}
};

export function TimelineDashboard({ initialSessionId, onNavigate }: Props) {
	const api = useApi();
	const [sessionInput, setSessionInput] = useState(initialSessionId ?? "");
	const [sessionId, setSessionId] = useState(initialSessionId ?? "");
	const [data, setData] = useState<TimelineResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [kindFilter, setKindFilter] = useState<Set<Kind>>(
		new Set(["span", "log", "usage"]),
	);
	const [cursor, setCursor] = useState<string | null>(null);
	const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
	const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
	const [showPasteId, setShowPasteId] = useState(false);
	const eventRefs = useRef<Record<string, HTMLButtonElement | null>>({});

	const selectedEvent = useMemo(() => {
		if (!data || !selectedEventId) return null;
		return data.events.find((e) => e.id === selectedEventId) ?? null;
	}, [data, selectedEventId]);

	const load = useCallback(
		async (id: string) => {
			if (!id) return;
			setLoading(true);
			try {
				const res = await api<TimelineResponse>(
					`/timeline/${encodeURIComponent(id)}`,
				);
				setData(res);
				setCursor(res.firstSeen);
			} catch (err) {
				console.error(err);
			} finally {
				setLoading(false);
			}
		},
		[api],
	);

	// Fetch recent sessions on mount so the user has something to land on.
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await api<RecentSessionsResponse>(
					"/usage/sessions?hours=72&filter=all&limit=20",
				);
				if (cancelled) return;
				setRecentSessions(res.sessions ?? []);
				// Auto-load the most recent session if no explicit id was passed.
				if (!initialSessionId && (res.sessions ?? []).length > 0) {
					const first = res.sessions[0];
					setSessionInput(first.sessionId);
					setSessionId(first.sessionId);
					onNavigate({ tab: "timeline", sessionId: first.sessionId });
				}
			} catch (err) {
				console.error(err);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [api, initialSessionId, onNavigate]);

	useEffect(() => {
		if (sessionId) load(sessionId);
	}, [sessionId, load]);

	useEffect(() => {
		if (initialSessionId && initialSessionId !== sessionId) {
			setSessionInput(initialSessionId);
			setSessionId(initialSessionId);
		}
	}, [initialSessionId, sessionId]);

	const sessionOptions = useMemo<Array<[string, string]>>(() => {
		// Keep the currently-selected session in the list even if it's not in
		// the recent-20 (e.g. the user pasted an id).
		const known = new Set(recentSessions.map((s) => s.sessionId));
		const opts: Array<[string, string]> = recentSessions.map((s) => {
			const dur =
				new Date(s.lastSeen).getTime() - new Date(s.firstSeen).getTime();
			const durStr =
				dur < 60_000
					? `${Math.round(dur / 1000)}s`
					: `${Math.round(dur / 60_000)}m`;
			const errBadge = s.errorCount > 0 ? ` · ${s.errorCount} err` : "";
			const path = s.lastPath ? ` · ${s.lastPath}` : "";
			return [
				s.sessionId,
				`${fmtRelative(s.lastSeen)} · ${s.eventCount} ev · ${durStr}${errBadge}${path}`,
			];
		});
		if (sessionId && !known.has(sessionId)) {
			opts.unshift([sessionId, `${sessionId.slice(0, 12)}… (custom)`]);
		}
		return opts;
	}, [recentSessions, sessionId]);

	const { startMs, durationMs } = useMemo(() => {
		if (!data?.firstSeen || !data?.lastSeen) {
			return { startMs: 0, endMs: 0, durationMs: 0 };
		}
		const start = new Date(data.firstSeen).getTime();
		const end = new Date(data.lastSeen).getTime();
		return { startMs: start, endMs: end, durationMs: Math.max(1, end - start) };
	}, [data]);

	const filteredEvents = useMemo(() => {
		if (!data) return [];
		return data.events.filter((e) => kindFilter.has(e.kind));
	}, [data, kindFilter]);

	const toggleKind = (k: Kind) => {
		setKindFilter((prev) => {
			const next = new Set(prev);
			if (next.has(k)) next.delete(k);
			else next.add(k);
			return next;
		});
	};

	const jumpTo = (ev: TimelineEvent) => {
		setCursor(ev.t);
		setSelectedEventId(ev.id);
		const node = eventRefs.current[ev.id];
		if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
	};

	// Pull a trace id out of an event's payload if there is one — works for
	// both SPAN events (top-level traceId) and LOG events (some logs carry
	// traceId in their attributes).
	const extractTraceId = (ev: TimelineEvent): string | null => {
		const p = ev.payload as Record<string, unknown>;
		if (typeof p.traceId === "string" && p.traceId) return p.traceId;
		if (
			p.attributes &&
			typeof p.attributes === "object" &&
			!Array.isArray(p.attributes)
		) {
			const a = p.attributes as Record<string, unknown>;
			if (typeof a["trace.id"] === "string") return a["trace.id"];
			if (typeof a.traceId === "string") return a.traceId;
		}
		return null;
	};

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg font-sans text-sys-on-surface p-2">
			<div className="mb-2 flex-none flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2">
				<span className="text-[0.8125rem] font-semibold">Timeline</span>
				{sessionOptions.length > 0 && !showPasteId && (
					<Select
						className="min-w-[320px] flex-1"
						value={sessionId}
						onChange={(e) => {
							setSessionId(e.target.value);
							setSessionInput(e.target.value);
							onNavigate({ tab: "timeline", sessionId: e.target.value });
						}}
						options={sessionOptions}
					/>
				)}
				{showPasteId && (
					<Input
						type="text"
						className="min-w-[260px] flex-1 font-mono"
						placeholder="Paste session id"
						value={sessionInput}
						onChange={(e) => setSessionInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								setSessionId(sessionInput.trim());
								onNavigate({ tab: "timeline", sessionId: sessionInput.trim() });
							}
						}}
					/>
				)}
				<Button
					size="sm"
					onClick={() => setShowPasteId((v) => !v)}
					title={
						showPasteId ? "Pick from recent sessions" : "Paste a session id"
					}
				>
					{showPasteId ? "Recent" : "Paste id"}
				</Button>
				{showPasteId && (
					<Button
						variant="primary"
						size="sm"
						onClick={() => {
							setSessionId(sessionInput.trim());
							onNavigate({ tab: "timeline", sessionId: sessionInput.trim() });
						}}
					>
						Load
					</Button>
				)}
				{(["span", "log", "usage"] as Kind[]).map((k) => (
					<Button
						key={k}
						size="xs"
						active={kindFilter.has(k)}
						activeClassName="bg-sys-on-surface text-sys-surface font-semibold"
						onClick={() => toggleKind(k)}
						title={`Toggle ${KIND_LABEL[k]}`}
					>
						{KIND_LABEL[k]} ·{" "}
						{data?.counts[
							k === "span" ? "spans" : k === "log" ? "logs" : "usage"
						] ?? 0}
					</Button>
				))}
				{data?.replay && (
					<Button
						variant="accent"
						onClick={() =>
							onNavigate({ tab: "replay", sessionId: data.sessionId })
						}
					>
						Open replay · {data.replay.chunkCount}
					</Button>
				)}
				<div className="ml-auto">
					<UpdatedChip at={data?.timestamp ?? null} />
				</div>
			</div>

			{!sessionId && recentSessions.length === 0 && !loading && (
				<Card className="p-3">
					<p className="text-[0.8125rem] text-sys-on-surface-muted">
						No sessions yet. Run <code className="font-mono">pnpm seed</code> to
						generate sample data, or visit Playground and click around to
						capture a real session.
					</p>
				</Card>
			)}

			{sessionId && loading && !data && <StateRow>Loading…</StateRow>}

			{data && durationMs > 0 && (
				<Card className="mb-2 p-3">
					<div className="mb-1 flex flex-none items-baseline gap-3">
						<span className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface">
							Session {data.sessionId.slice(0, 16)}…
						</span>
						<span className="font-mono text-[0.6875rem] text-sys-on-surface-muted">
							{Math.round(durationMs / 1000)}s · {data.events.length} events
						</span>
					</div>
					<div className="mt-3 flex flex-col gap-2">
						{(["span", "log", "usage"] as Kind[]).map((k) => (
							<Lane
								key={k}
								kind={k}
								events={data.events.filter((e) => e.kind === k)}
								startMs={startMs}
								durationMs={durationMs}
								cursor={cursor}
								onSelect={jumpTo}
							/>
						))}
					</div>
					<div className="mt-3 flex justify-between font-mono text-[0.6875rem] text-sys-on-surface-muted">
						<span>{data.firstSeen ? fmtTs(data.firstSeen) : "—"}</span>
						<span>{data.lastSeen ? fmtTs(data.lastSeen) : "—"}</span>
					</div>
				</Card>
			)}

			{data && (
				<div className="flex min-h-0 flex-1 gap-2">
					<Card className="min-h-0 flex-1 overflow-y-auto p-3">
						<SectionTitle
							title="Events"
							note={`${filteredEvents.length.toLocaleString()} shown`}
						/>
						<div className="mt-1 flex flex-col">
							{filteredEvents.map((ev) => {
								const offsetMs = new Date(ev.t).getTime() - startMs;
								const active = selectedEventId === ev.id;
								return (
									<button
										key={ev.id}
										type="button"
										ref={(node) => {
											eventRefs.current[ev.id] = node;
										}}
										className={`border-b-[1px] border-sys-surface-low p-2 font-mono text-[0.75rem] flex items-start gap-2 last:border-b-0 text-left transition-none cursor-pointer hover:bg-sys-surface-low ${
											active ? "bg-sys-surface-high" : ""
										}`}
										onClick={() => jumpTo(ev)}
									>
										<span
											className={`flex-none px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${
												ev.severity === "error"
													? "bg-sys-error text-sys-on-error"
													: ev.severity === "warn"
														? "bg-sys-warning text-sys-on-warning"
														: "bg-sys-surface-high text-sys-on-surface"
											}`}
										>
											{ev.kind}
										</span>
										<div className="flex-1 min-w-0">
											<div className="flex justify-between items-center mb-1">
												<span className="font-bold truncate">{ev.title}</span>
												<span className="opacity-60 flex-none pl-2">
													+{(offsetMs / 1000).toFixed(2)}s · {fmtTs(ev.t)}
													{ev.durationMs != null
														? ` · ${Math.round(ev.durationMs)}ms`
														: ""}
												</span>
											</div>
											{ev.subtitle && (
												<p className="opacity-70 m-0 break-all">
													{ev.subtitle}
												</p>
											)}
										</div>
									</button>
								);
							})}
						</div>
						{filteredEvents.length === 0 && (
							<p className="py-2 text-[0.8125rem] text-sys-on-surface-muted">
								No events matching selected kinds.
							</p>
						)}
					</Card>

					{selectedEvent && (
						<EventDrawer
							event={selectedEvent}
							sessionId={data.sessionId}
							offsetMs={new Date(selectedEvent.t).getTime() - startMs}
							hasReplay={Boolean(data.replay)}
							traceId={extractTraceId(selectedEvent)}
							onClose={() => setSelectedEventId(null)}
							onNavigate={onNavigate}
						/>
					)}
				</div>
			)}
		</div>
	);
}

function EventDrawer({
	event,
	sessionId,
	offsetMs,
	hasReplay,
	traceId,
	onClose,
	onNavigate,
}: {
	event: TimelineEvent;
	sessionId: string;
	offsetMs: number;
	hasReplay: boolean;
	traceId: string | null;
	onClose: () => void;
	onNavigate: (route: {
		tab?: string;
		sessionId?: string;
		traceId?: string;
	}) => void;
}) {
	return (
		<Card className="flex w-[380px] flex-none flex-col overflow-hidden">
			<div className="flex flex-none items-center justify-between border-b border-sys-outline-soft px-3 py-2">
				<span className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
					Event detail
				</span>
				<Button size="xs" onClick={onClose}>
					Close
				</Button>
			</div>
			<div className="flex flex-col gap-3 overflow-y-auto p-3">
				<div className="flex items-start gap-2">
					<span
						className={`flex-none px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${
							event.severity === "error"
								? "bg-sys-error text-sys-on-error"
								: event.severity === "warn"
									? "bg-sys-warning text-sys-on-warning"
									: "bg-sys-surface-low text-sys-on-surface"
						}`}
					>
						{event.kind}
					</span>
					<div className="min-w-0 flex-1">
						<div className="break-all text-[0.8125rem] font-semibold">
							{event.title}
						</div>
						{event.subtitle && (
							<div className="mt-0.5 break-all font-mono text-[0.6875rem] text-sys-on-surface-muted">
								{event.subtitle}
							</div>
						)}
					</div>
				</div>

				<div className="grid grid-cols-2 gap-2 text-[0.6875rem] font-mono text-sys-on-surface-muted">
					<div>
						<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
							Timestamp
						</div>
						<div>{fmtTs(event.t)}</div>
					</div>
					<div>
						<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
							Offset
						</div>
						<div>+{(offsetMs / 1000).toFixed(2)}s</div>
					</div>
					{event.durationMs != null && (
						<div>
							<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
								Duration
							</div>
							<div>{Math.round(event.durationMs)}ms</div>
						</div>
					)}
					{traceId && (
						<div className="col-span-2">
							<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
								Trace
							</div>
							<div className="break-all">{traceId.slice(0, 32)}…</div>
						</div>
					)}
				</div>

				<div className="flex flex-wrap gap-2">
					{traceId && (
						<Button
							variant="primary"
							size="sm"
							onClick={() => onNavigate({ tab: "traces", traceId })}
						>
							View trace
						</Button>
					)}
					{hasReplay && (
						<Button
							variant="accent"
							size="sm"
							onClick={() => onNavigate({ tab: "replay", sessionId })}
							title={`Replay starting from session start (cursor at +${(offsetMs / 1000).toFixed(1)}s not yet wired)`}
						>
							Open replay
						</Button>
					)}
				</div>

				<JsonBlock
					label="Payload"
					value={JSON.stringify(event.payload, null, 2)}
					maxHeight={420}
				/>
			</div>
		</Card>
	);
}

function Lane({
	kind,
	events,
	startMs,
	durationMs,
	cursor,
	onSelect,
}: {
	kind: Kind;
	events: TimelineEvent[];
	startMs: number;
	durationMs: number;
	cursor: string | null;
	onSelect: (ev: TimelineEvent) => void;
}) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-16 flex-none text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
				{KIND_LABEL[kind]}
			</span>
			<div
				className="relative h-8 flex-1 bg-sys-surface-low"
				style={{ borderLeft: `2px solid ${KIND_COLOR[kind]}` }}
			>
				{events.map((ev) => {
					const offset = new Date(ev.t).getTime() - startMs;
					const left = `${Math.max(0, Math.min(100, (offset / durationMs) * 100))}%`;
					const active = cursor === ev.t;
					return (
						<button
							key={ev.id}
							type="button"
							onClick={() => onSelect(ev)}
							title={ev.title}
							className="absolute top-1 bottom-1 cursor-pointer transition-none"
							style={{
								left,
								width: 3,
								transform: "translateX(-1px)",
								background:
									ev.severity === "error"
										? "var(--color-sys-error)"
										: ev.severity === "warn"
											? "var(--color-sys-warning)"
											: KIND_COLOR[kind],
								outline: active
									? "1px solid var(--color-sys-on-surface)"
									: "none",
								outlineOffset: 1,
							}}
						/>
					);
				})}
			</div>
			<span className="w-10 flex-none text-right font-mono text-[0.6875rem] text-sys-on-surface-muted tabular-nums">
				{events.length}
			</span>
		</div>
	);
}
