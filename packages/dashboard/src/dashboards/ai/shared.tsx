import type { JsonValue } from "@obsunified/types";

// ── Shared ─────────────────────────────────────────────────────────────────

export const SPAN_KINDS = [
	"LLM",
	"Tool",
	"Retriever",
	"Embedding",
	"Chain",
	"Agent",
	"Reranker",
	"Guardrail",
] as const;

// Muted, distinct hue per kind. Matches the overall monochrome palette.
export const KIND_BG: Record<string, string> = {
	LLM: "bg-sys-primary",
	TOOL: "bg-sys-accent",
	RETRIEVER: "bg-sys-warning",
	EMBEDDING: "bg-sys-outline",
	CHAIN: "bg-sys-surface-low",
	AGENT: "bg-sys-surface-low",
	RERANKER: "bg-sys-outline",
	GUARDRAIL: "bg-sys-error",
};

export function KindBadge({ kind }: { kind: string }) {
	const bg = KIND_BG[kind] ?? "bg-sys-surface-low";
	const text =
		kind === "Chain" || kind === "Agent"
			? "text-sys-on-surface border border-sys-outline"
			: "text-white";
	return (
		<span
			className={`inline-block px-1.5 py-[2px] text-[0.5rem] font-bold uppercase tracking-[0.08em] leading-none ${bg} ${text}`}
			style={{ minWidth: 56, textAlign: "center" }}
		>
			{kind}
		</span>
	);
}

export function attrString(
	attrs: Record<string, JsonValue>,
	key: string,
): string | undefined {
	const v = attrs[key];
	return typeof v === "string" ? v : undefined;
}
export function attrNumber(
	attrs: Record<string, JsonValue>,
	key: string,
): number | undefined {
	const v = attrs[key];
	return typeof v === "number" ? v : undefined;
}

export function formatCost(usd: number | undefined): string | null {
	if (usd === undefined || usd === 0) return null;
	if (usd < 0.0001) return `<$0.0001`;
	return `$${usd.toFixed(4)}`;
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}
