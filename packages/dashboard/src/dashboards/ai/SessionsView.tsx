import type {
	AISessionDetailResponse,
	AISessionSummary,
	AISessionsListResponse,
} from "@obsunified/types";
import { useCallback, useEffect, useState } from "react";
import { Card, SectionTitle } from "../../components/primitives";
import { ErrorState, StateRow } from "../../components/states";
import { errorMessage, isAbortError, useApi } from "../../use-api";
import { ConversationPane, extractLastUserMessage } from "./ConversationPane";
import { Toolbar, type View } from "./Toolbar";

interface SessionsViewProps {
	hours: string;
	view: View;
	setView: (v: View) => void;
}

// ── Sessions view ──────────────────────────────────────────────────────────

export function SessionsView({ hours, view, setView }: SessionsViewProps) {
	const api = useApi();
	const [data, setData] = useState<AISessionsListResponse | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [detail, setDetail] = useState<AISessionDetailResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState<string | null>(null);

	const load = useCallback(
		async (signal?: AbortSignal) => {
			const res = await api<AISessionsListResponse>(
				`/ai/sessions?hours=${hours}`,
				{
					signal,
				},
			);
			setData(res);
		},
		[api, hours],
	);

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		setLoadError(null);
		load(controller.signal)
			.catch((err) => {
				if (isAbortError(err)) return;
				setLoadError(errorMessage(err));
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [load]);

	useEffect(() => {
		if (!selected) {
			setDetail(null);
			setDetailError(null);
			setDetailLoading(false);
			return;
		}
		const controller = new AbortController();
		setDetail(null);
		setDetailError(null);
		setDetailLoading(true);
		(async () => {
			try {
				const res = await api<AISessionDetailResponse>(
					`/ai/sessions/${encodeURIComponent(selected)}`,
					{ signal: controller.signal },
				);
				setDetail(res);
			} catch (err) {
				if (isAbortError(err)) return;
				setDetailError(errorMessage(err));
			} finally {
				if (!controller.signal.aborted) setDetailLoading(false);
			}
		})();
		return () => controller.abort();
	}, [selected, api]);

	const sessions = data?.sessions ?? [];

	return (
		<>
			<Toolbar
				view={view}
				setView={setView}
				updatedAt={data?.timestamp ?? null}
			>
				<div className="text-[0.6875rem] font-mono opacity-60">
					{sessions.length} session{sessions.length === 1 ? "" : "s"}
				</div>
			</Toolbar>

			{loadError && (
				<div className="flex-none px-2 pt-2">
					<ErrorState message={loadError} />
				</div>
			)}

			{/* When a session is selected, the conversation pane needs a real
			    minimum width or its monospace content (long error messages
			    like rate_limit_exceeded, multi-line model outputs) collapses
			    to one-character-per-line vertical text. minmax(360px,…) for
			    the conversation column guarantees ChatBubble's break-words
			    has somewhere to actually break. The session list is secondary
			    here, so we let IT shrink first on narrow viewports. */}
			<div
				className="flex-1 min-h-0 grid gap-2 p-2"
				style={{
					gridTemplateColumns: selected
						? "minmax(240px,360px) minmax(360px,1fr)"
						: "minmax(0,1fr)",
				}}
			>
				<Card className="min-h-0 overflow-hidden flex flex-col">
					<SectionTitle
						title="Sessions"
						note={`${sessions.length} in window`}
					/>
					<div className="flex-1 overflow-y-auto">
						{loading && !data && <StateRow>Loading AI sessions…</StateRow>}
						{sessions.map((s) => (
							<SessionRow
								key={s.sessionId}
								session={s}
								selected={selected === s.sessionId}
								onClick={() =>
									setSelected(selected === s.sessionId ? null : s.sessionId)
								}
							/>
						))}
						{!loading && !loadError && sessions.length === 0 && (
							<div className="p-6 text-center text-[0.75rem] opacity-60 leading-relaxed">
								No sessions yet.
								<br />
								Stamp a{" "}
								<code className="bg-sys-surface-low px-1">session.id</code> on
								your AI spans with{" "}
								<code className="bg-sys-surface-low px-1">
									setAISessionContext()
								</code>
								.
							</div>
						)}
					</div>
				</Card>

				{selected && (
					<Card className="min-h-0 overflow-hidden flex flex-col">
						<ConversationPane
							detail={detail}
							loading={detailLoading}
							error={detailError}
							onClose={() => setSelected(null)}
						/>
					</Card>
				)}
			</div>
		</>
	);
}

function SessionRow({
	session,
	selected,
	onClick,
}: {
	session: AISessionSummary;
	selected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-full text-left px-3 py-2.5 border-b border-sys-outline/30 hover:bg-sys-surface-low cursor-pointer transition-none ${
				selected ? "bg-sys-surface-low border-l-[3px] border-l-sys-primary" : ""
			}`}
		>
			<div className="flex items-center gap-2 text-[0.75rem] font-mono">
				<span className="font-bold truncate flex-1">{session.sessionId}</span>
				<span className="opacity-60">{session.spanCount} spans</span>
			</div>
			<div className="mt-1 flex flex-wrap items-center gap-2 text-[0.625rem] font-mono opacity-70">
				{session.userId && (
					<a
						href={`#/users/${encodeURIComponent(session.userId)}`}
						onClick={(e) => e.stopPropagation()}
						className="hover:underline cursor-pointer"
						title="Open user detail"
					>
						👤 {session.userId}
					</a>
				)}
				{session.llmSpanCount > 0 && <span>{session.llmSpanCount} LLM</span>}
				{session.totalCostUsd > 0 && (
					<span>${session.totalCostUsd.toFixed(4)}</span>
				)}
				{session.errorCount > 0 && (
					<span className="text-sys-error font-bold">
						{session.errorCount} err
					</span>
				)}
				<span className="ml-auto opacity-60">
					{new Date(session.lastSpanAt).toLocaleTimeString()}
				</span>
			</div>
			{session.lastInputPreview && (
				<div className="mt-1 text-[0.6875rem] font-mono opacity-60 line-clamp-2">
					{extractLastUserMessage(session.lastInputPreview) ??
						session.lastInputPreview}
				</div>
			)}
		</button>
	);
}
