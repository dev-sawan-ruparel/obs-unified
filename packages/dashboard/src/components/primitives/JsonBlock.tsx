import { type ReactNode, useMemo, useState } from "react";

// ── JsonBlock: pretty-prints JSON, collapsible, copy-to-clipboard ──

const PREVIEW_CHARS = 280;

export function JsonBlock({
	value,
	label,
	accent,
	maxHeight = 220,
}: {
	value: string | null | undefined;
	label?: string;
	accent?: "primary" | "error" | "accent" | "default";
	maxHeight?: number;
}) {
	const [expanded, setExpanded] = useState(false);
	const [copied, setCopied] = useState(false);
	const pretty = useMemo(() => (value ? tryPrettyJson(value) : null), [value]);
	const raw = pretty ?? value ?? "";

	if (!value) {
		return (
			<div className="flex flex-col">
				{label && <BlockLabel>{label}</BlockLabel>}
				<div className="bg-sys-surface-low p-2 text-[0.75rem] opacity-50 italic border-l-[3px] border-sys-outline">
					empty
				</div>
			</div>
		);
	}

	const borderClass =
		accent === "error"
			? "border-sys-error text-sys-error"
			: accent === "accent"
				? "border-sys-accent text-sys-on-surface"
				: "border-sys-primary text-sys-on-surface";

	const isLong = raw.length > PREVIEW_CHARS;
	const visible = expanded || !isLong ? raw : `${raw.slice(0, PREVIEW_CHARS)}…`;

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(raw);
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		} catch {
			// noop — clipboard unavailable (e.g. http context)
		}
	};

	return (
		<div className="flex flex-col min-w-0">
			{label && (
				<div className="flex items-center justify-between gap-2 mb-1">
					<BlockLabel>{label}</BlockLabel>
					<div className="flex items-center gap-2">
						{pretty && (
							<span className="text-[0.5rem] font-bold uppercase tracking-[0.05em] opacity-40">
								JSON
							</span>
						)}
						<button
							type="button"
							onClick={onCopy}
							className="text-[0.5rem] font-bold uppercase tracking-[0.05em] opacity-60 hover:opacity-100 cursor-pointer"
						>
							{copied ? "✓ copied" : "copy"}
						</button>
					</div>
				</div>
			)}
			<pre
				className={`bg-sys-surface-low p-2 text-[0.6875rem] leading-relaxed border-l-[3px] break-all whitespace-pre-wrap font-mono overflow-y-auto ${borderClass}`}
				style={{ maxHeight: expanded ? maxHeight * 2 : maxHeight }}
			>
				{visible}
			</pre>
			{isLong && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="mt-1 text-[0.5rem] font-bold uppercase tracking-[0.05em] opacity-60 hover:opacity-100 cursor-pointer self-start"
				>
					{expanded
						? "▴ collapse"
						: `▾ expand (${raw.length.toLocaleString()} chars)`}
				</button>
			)}
		</div>
	);
}

function BlockLabel({ children }: { children: ReactNode }) {
	return (
		<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">
			{children}
		</div>
	);
}

function tryPrettyJson(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2);
	} catch {
		return null;
	}
}
