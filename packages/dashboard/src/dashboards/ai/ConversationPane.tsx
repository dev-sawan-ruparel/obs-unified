import type {
	AIEvaluationRecord,
	AISessionDetailResponse,
	AISpanRecord,
} from "@obsunified/types";
import { useMemo } from "react";
import { ChatBubble, Chip } from "../../components/primitives";
import { ErrorState } from "../../components/states";
import { attrString, formatDuration, KindBadge } from "./shared";

// ── Conversation pane ──────────────────────────────────────────────────────

export function ConversationPane({
	detail,
	loading,
	error,
	onClose,
}: {
	detail: AISessionDetailResponse | null;
	loading: boolean;
	error: string | null;
	onClose: () => void;
}) {
	const evalsBySpan = useMemo(() => {
		const map = new Map<string, AIEvaluationRecord[]>();
		for (const e of detail?.evaluations ?? []) {
			if (!map.has(e.spanId)) map.set(e.spanId, []);
			map.get(e.spanId)?.push(e);
		}
		return map;
	}, [detail]);

	if (!detail) {
		return (
			<>
				<div className="flex items-center justify-between gap-2 border-b border-sys-outline/30 p-3">
					<div className="font-bold font-mono text-[0.875rem] truncate">
						Session detail
					</div>
					<button
						type="button"
						onClick={onClose}
						className="text-[0.75rem] opacity-60 hover:opacity-100 cursor-pointer"
						aria-label="Close conversation"
					>
						✕
					</button>
				</div>
				{error ? (
					<ErrorState
						title="Failed to load session"
						message={error}
						className="m-3"
					/>
				) : (
					<div className="p-3 text-[0.75rem] opacity-60 font-mono">
						{loading ? "Loading session…" : "Session detail unavailable."}
					</div>
				)}
			</>
		);
	}

	return (
		<>
			<div className="flex items-start justify-between gap-2 border-b border-sys-outline/30 p-3">
				<div className="flex flex-col gap-1 min-w-0">
					<div className="font-bold font-mono text-[0.875rem] truncate">
						{detail.sessionId}
					</div>
					<div className="flex flex-wrap items-center gap-3 text-[0.625rem] font-mono opacity-70">
						{detail.userId && (
							<a
								href={`#/users/${encodeURIComponent(detail.userId)}`}
								className="hover:underline cursor-pointer"
								title="Open user detail (RFC 0006 — Scenario B pivot)"
							>
								👤 {detail.userId}
							</a>
						)}
						<span>{detail.summary.spanCount} spans</span>
						<span>
							{detail.summary.totalPromptTokens}↑ /{" "}
							{detail.summary.totalCompletionTokens}↓ tok
						</span>
						<span>${detail.summary.totalCostUsd.toFixed(4)}</span>
						{detail.summary.errorCount > 0 && (
							<span className="text-sys-error font-bold">
								{detail.summary.errorCount} errors
							</span>
						)}
					</div>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="text-[0.75rem] opacity-60 hover:opacity-100 cursor-pointer"
					aria-label="Close conversation"
				>
					✕
				</button>
			</div>

			<div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-sys-bg">
				{detail.spans.map((span) => (
					<ConversationTurn
						key={`${span.traceId}-${span.spanId}`}
						span={span}
						evals={evalsBySpan.get(span.spanId) ?? []}
					/>
				))}
			</div>
		</>
	);
}

/**
 * Each LLM span in a session typically has its FULL prior conversation in
 * `input` (that's just how chat APIs are called). Rendering the whole array
 * for every turn would duplicate every earlier message. So for the session
 * thread we extract only the *new* user input (last user message in the
 * input array) and pair it with this turn's assistant output.
 */
export function extractLastUserMessage(
	inputJson: string | null,
): string | null {
	if (!inputJson) return null;
	try {
		const parsed = JSON.parse(inputJson);
		if (typeof parsed === "string") return parsed;
		if (!Array.isArray(parsed)) return null;
		for (let i = parsed.length - 1; i >= 0; i--) {
			const m = parsed[i];
			if (m && typeof m === "object" && "role" in m && "content" in m) {
				const message = m as Record<string, unknown>;
				const role = String(message.role).toLowerCase();
				if (role === "user" || role === "human") {
					return coerceStringContent(message.content);
				}
			}
		}
	} catch {
		// Session previews come back truncated from the collector (first 200
		// chars of the input JSON), so JSON.parse fails on the fragment.
		// Fall back to a regex that finds the LAST `"role":"user","content":…`
		// pair, even if the string is mid-truncation.
		const re =
			/"role"\s*:\s*"(?:user|human)"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)/gi;
		let m: RegExpExecArray | null;
		let last: string | null = null;
		m = re.exec(inputJson);
		while (m !== null) {
			last = m[1] ?? null;
			m = re.exec(inputJson);
		}
		if (last) {
			try {
				return JSON.parse(`"${last}"`);
			} catch {
				return last;
			}
		}
	}
	return null;
}

function extractAssistantText(outputJson: string | null): string | null {
	if (!outputJson) return null;
	try {
		const parsed = JSON.parse(outputJson);
		if (typeof parsed === "string") return parsed;
		if (parsed && typeof parsed === "object") {
			const output = parsed as Record<string, unknown>;
			if ("content" in output) return coerceStringContent(output.content);
			// Anthropic: { content: [{type:"text", text}] }
			if (Array.isArray(output.content)) {
				return coerceStringContent(output.content);
			}
		}
	} catch {
		/* fall through */
	}
	return outputJson;
}

function coerceStringContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((p) =>
				typeof p === "string"
					? p
					: p && typeof p === "object" && "text" in p
						? String((p as Record<string, unknown>).text ?? "")
						: "",
			)
			.filter(Boolean)
			.join("\n");
	}
	return String(content ?? "");
}

function ConversationTurn({
	span,
	evals,
}: {
	span: AISpanRecord;
	evals: AIEvaluationRecord[];
}) {
	const isError = span.statusCode === 2;
	const model = attrString(span.attributes, "llm.model_name");
	const toolName = attrString(span.attributes, "tool.name");

	if (span.spanKind === "LLM") {
		const userText = extractLastUserMessage(span.inputJson);
		const assistantText = isError
			? (span.statusMessage ?? "Error")
			: (extractAssistantText(span.outputJson) ?? "");

		return (
			<div className="flex flex-col gap-2">
				{userText && (
					<ChatBubble speaker="user" timestamp={span.startTime}>
						<span className="whitespace-pre-wrap break-words">{userText}</span>
					</ChatBubble>
				)}
				<ChatBubble
					speaker="assistant"
					subtitle={model}
					accent={isError ? "error" : undefined}
				>
					<span
						className={`whitespace-pre-wrap break-words ${isError ? "text-sys-error" : ""}`}
					>
						{assistantText}
					</span>
				</ChatBubble>
				{evals.length > 0 && (
					<div className="flex flex-wrap gap-1 self-end">
						{evals.map((e) => (
							<EvalPill key={e.evaluationId} evaluation={e} />
						))}
					</div>
				)}
			</div>
		);
	}

	// Non-LLM: render as a subtle full-width activity row.
	const label = toolName ?? span.spanName;
	return (
		<div className="flex items-center gap-2 self-stretch text-[0.625rem] font-mono opacity-80">
			<KindBadge kind={span.spanKind} />
			<span className="font-bold">{label}</span>
			<div className="flex-1 h-px bg-sys-outline/40" />
			<span className="opacity-60">{formatDuration(span.durationMs)}</span>
			<span className="opacity-40">
				{new Date(span.startTime).toLocaleTimeString()}
			</span>
		</div>
	);
}

function EvalPill({ evaluation }: { evaluation: AIEvaluationRecord }) {
	const pass = evaluation.score !== null && evaluation.score >= 0.5;
	const tone = pass ? "primary" : "error";
	return (
		<Chip tone={tone}>
			{evaluation.name}
			{evaluation.score !== null && ` ${evaluation.score.toFixed(2)}`}
		</Chip>
	);
}
