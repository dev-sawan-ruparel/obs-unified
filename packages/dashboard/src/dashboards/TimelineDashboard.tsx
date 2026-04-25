import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../use-api";
import { Card, SectionTitle, UpdatedChip } from "../components/primitives";
import { Button } from "../components/Button";
import { Input } from "../components/forms";
import { StateRow } from "../components/states";

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
	const eventRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

	useEffect(() => {
		if (sessionId) load(sessionId);
	}, [sessionId, load]);

	useEffect(() => {
		if (initialSessionId && initialSessionId !== sessionId) {
			setSessionInput(initialSessionId);
			setSessionId(initialSessionId);
		}
	}, [initialSessionId, sessionId]);

	const { startMs, endMs, durationMs } = useMemo(() => {
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
		const node = eventRefs.current[ev.id];
		if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
	};

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg font-sans text-sys-on-surface p-2">
			<div className="mb-2 flex-none flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2">
				<span className="text-[0.8125rem] font-semibold">Timeline</span>
				<Input
					type="text"
					className="min-w-[260px] flex-1 font-mono"
					placeholder="Session ID"
					value={sessionInput}
					onChange={(e) => setSessionInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") setSessionId(sessionInput.trim());
					}}
				/>
				<Button variant="primary" onClick={() => setSessionId(sessionInput.trim())}>
					Load
				</Button>
				{(["span", "log", "usage"] as Kind[]).map((k) => (
					<Button
						key={k}
						size="xs"
						active={kindFilter.has(k)}
						activeClassName="bg-sys-on-surface text-sys-surface font-semibold"
						onClick={() => toggleKind(k)}
						title={`Toggle ${KIND_LABEL[k]}`}
					>
						{KIND_LABEL[k]} · {data?.counts[k === "span" ? "spans" : k === "log" ? "logs" : "usage"] ?? 0}
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

			{!sessionId && (
				<Card className="p-3">
					<p className="text-[0.8125rem] text-sys-on-surface-muted">
						Enter a session id to load its timeline.
					</p>
				</Card>
			)}

			{sessionId && loading && !data && <StateRow>Loading…</StateRow>}

			{data && durationMs > 0 && (
				<Card className="mb-2 p-3">
					<SectionTitle
						title={`Session ${data.sessionId.slice(0, 16)}…`}
						note={`${Math.round(durationMs / 1000)}s · ${data.events.length} events`}
					/>
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
					<div className="mt-3 flex justify-between text-[0.625rem] font-mono opacity-60">
						<span>{fmtTs(data.firstSeen!)}</span>
						<span>{fmtTs(data.lastSeen!)}</span>
					</div>
				</Card>
			)}

			{data && (
				<Card className="min-h-0 flex-1 overflow-y-auto p-3">
					<SectionTitle
						title="Events"
						note={`${filteredEvents.length.toLocaleString()} shown`}
					/>
					<div className="mt-1 flex flex-col">
						{filteredEvents.map((ev) => {
							const offsetMs =
								new Date(ev.t).getTime() - startMs;
							const active = cursor === ev.t;
							return (
								<div
									key={ev.id}
									ref={(node) => {
										eventRefs.current[ev.id] = node;
									}}
									className={`border-b-[1px] border-sys-surface-low p-2 font-mono text-[0.75rem] flex items-start gap-2 last:border-b-0 ${
										active ? "bg-sys-surface-high" : ""
									}`}
									onClick={() => setCursor(ev.t)}
								>
									<span
										className={`px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${
											ev.severity === "error"
												? "bg-sys-error text-white"
												: ev.severity === "warn"
													? "bg-sys-warning text-white"
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
											<p className="opacity-70 m-0 break-all">{ev.subtitle}</p>
										)}
									</div>
								</div>
							);
						})}
					</div>
					{filteredEvents.length === 0 && (
						<p className="py-2 text-[0.875rem] opacity-60 font-semibold">
							No events matching selected kinds.
						</p>
					)}
				</Card>
			)}
		</div>
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
			<span className="w-16 flex-none text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60">
				{KIND_LABEL[kind]}
			</span>
			<div
				className="relative h-6 flex-1 bg-sys-surface-low"
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
								outline: active ? "1px solid var(--color-sys-on-surface)" : "none",
								outlineOffset: 1,
							}}
						/>
					);
				})}
			</div>
			<span className="w-10 flex-none text-right text-[0.625rem] font-mono opacity-60">
				{events.length}
			</span>
		</div>
	);
}
