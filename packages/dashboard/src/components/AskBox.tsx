import type {
	AskEvidence,
	AskQuery,
	AskResponse,
} from "@obs-unified/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRawFetch } from "../use-api";

/**
 * RFC 0002 Stage 5 — Ask box. Quick-ask single-turn UI in the top bar.
 *
 * The user types a question, hits enter, we POST /internal/ask, and a
 * slide-down card appears beneath the input with the answer. The
 * "queries" log is collapsed by default — same trust-by-default,
 * verify-on-demand pattern as Cursor's chat.
 *
 * Cmd/ctrl+/ toggles focus.
 *
 * Full conversational `/ask` route ships in a follow-up; this is the
 * inline quick-ask only.
 */

type Phase = "idle" | "loading" | "answer" | "error";

export function AskBox() {
	const rawFetch = useRawFetch();
	const [open, setOpen] = useState(false);
	const [question, setQuestion] = useState("");
	const [phase, setPhase] = useState<Phase>("idle");
	const [response, setResponse] = useState<AskResponse | null>(null);
	const [showQueries, setShowQueries] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "/") {
				e.preventDefault();
				setOpen(true);
				setTimeout(() => inputRef.current?.focus(), 10);
			} else if (e.key === "Escape" && open) {
				setOpen(false);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onClick = (e: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", onClick);
		return () => document.removeEventListener("mousedown", onClick);
	}, [open]);

	const submit = useCallback(async () => {
		const q = question.trim();
		if (!q) return;
		setPhase("loading");
		setShowQueries(false);
		try {
			// Use raw fetch so we can read the structured AskResponse body even
			// on non-2xx (the collector returns 503 with `{ error }` when
			// ANTHROPIC_API_KEY isn't configured — we want the message).
			const res = await rawFetch("/ask", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ question: q }),
			});
			const body = (await res.json().catch(() => null)) as AskResponse | null;
			if (!body) {
				setResponse({
					answer: null,
					evidence: [],
					queries: [],
					error: `Ask failed: HTTP ${res.status}`,
					timestamp: new Date().toISOString(),
				});
				setPhase("error");
				return;
			}
			setResponse(body);
			setPhase(body.error && !body.answer ? "error" : "answer");
		} catch (e) {
			setResponse({
				answer: null,
				evidence: [],
				queries: [],
				error: e instanceof Error ? e.message : String(e),
				timestamp: new Date().toISOString(),
			});
			setPhase("error");
		}
	}, [rawFetch, question]);

	return (
		<div className="relative" ref={containerRef} data-test-ask>
			<button
				type="button"
				onClick={() => {
					setOpen((v) => !v);
					if (!open) setTimeout(() => inputRef.current?.focus(), 10);
				}}
				className="flex items-center gap-2 px-3 h-8 border border-sys-outline-soft hover:bg-sys-surface-low text-[0.75rem] text-sys-on-surface-muted"
				title="Ask (⌘/)"
				data-test-ask-toggle
			>
				<span aria-hidden="true">✺</span>
				<span>Ask</span>
				<span className="opacity-50 font-mono">⌘/</span>
			</button>

			{open ? (
				<div
					className="absolute right-0 top-full mt-1 w-[28rem] bg-sys-surface border border-sys-outline shadow-lg z-50"
					data-test-ask-panel
				>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							submit();
						}}
						className="p-2 border-b border-sys-outline-soft"
					>
						<input
							ref={inputRef}
							type="text"
							placeholder="is checkout slow? any new errors? …"
							value={question}
							onChange={(e) => setQuestion(e.target.value)}
							className="w-full bg-sys-bg border border-sys-outline-soft px-3 h-8 text-[0.8125rem] focus:outline-none focus:border-sys-primary"
							data-test-ask-input
						/>
					</form>

					{phase === "loading" ? (
						<div
							className="p-3 text-[0.75rem] text-sys-on-surface-muted italic"
							data-test-ask-loading
						>
							thinking…
						</div>
					) : null}

					{phase === "error" && response?.error ? (
						<div
							className="p-3 text-[0.75rem] text-sys-error border-l-[3px] border-sys-error bg-sys-error/5"
							data-test-ask-error
						>
							{response.error}
						</div>
					) : null}

					{phase === "answer" && response?.answer ? (
						<div className="flex flex-col" data-test-ask-answer>
							<div className="p-3 text-[0.8125rem] leading-relaxed border-l-[3px] border-sys-primary bg-sys-surface">
								{response.answer}
							</div>
							{response.evidence.length > 0 ? (
								<div className="px-3 pt-1 pb-2 flex flex-wrap gap-1">
									{response.evidence.map((ev) => (
										<EvidenceChip key={ev.analysisId} evidence={ev} />
									))}
								</div>
							) : null}
							{response.queries.length > 0 ? (
								<div className="px-3 pb-2">
									<button
										type="button"
										onClick={() => setShowQueries((v) => !v)}
										className="text-[0.6875rem] text-sys-on-surface-muted hover:text-sys-on-surface"
										data-test-ask-toggle-queries
									>
										{showQueries
											? "Hide"
											: "Show"}{" "}
										the queries I ran ({response.queries.length})
									</button>
									{showQueries ? (
										<ul
											className="mt-1 flex flex-col gap-0.5 font-mono text-[0.6875rem] text-sys-on-surface-muted"
											data-test-ask-queries
										>
											{response.queries.map((q, i) => (
												<li key={i}>
													<QueryLine query={q} />
												</li>
											))}
										</ul>
									) : null}
								</div>
							) : null}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function EvidenceChip({ evidence }: { evidence: AskEvidence }) {
	const href =
		evidence.definition.view === "page"
			? `#/investigate/${encodeURIComponent(evidence.analysisId)}`
			: "#/health";
	return (
		<a
			href={href}
			className="text-[0.6875rem] font-mono px-1.5 py-0.5 bg-sys-surface-low hover:bg-sys-surface-high border border-sys-outline-soft no-underline text-inherit"
			data-test-ask-evidence={evidence.analysisId}
		>
			{evidence.analysisId}
		</a>
	);
}

function QueryLine({ query }: { query: AskQuery }) {
	const argsStr =
		Object.keys(query.args).length === 0
			? ""
			: ` ${JSON.stringify(query.args)}`;
	return (
		<span>
			<span className="text-sys-on-surface">{query.tool}</span>
			{argsStr}
			<span className="opacity-60"> · {query.durationMs}ms</span>
		</span>
	);
}

export default AskBox;
