import type { ReactNode } from "react";

// ── Chat bubble: for conversation-style session thread ──

export function ChatBubble({
	speaker,
	children,
	timestamp,
	subtitle,
	accent,
}: {
	speaker: "user" | "assistant" | "system" | "tool";
	children: ReactNode;
	timestamp?: string;
	subtitle?: string;
	accent?: "primary" | "accent" | "warning" | "error";
}) {
	const align =
		speaker === "user"
			? "self-start"
			: speaker === "assistant"
				? "self-end"
				: "self-center";
	const bg =
		speaker === "user"
			? "bg-sys-surface"
			: speaker === "assistant"
				? accent === "error"
					? "bg-sys-error/10 border border-sys-error"
					: "bg-sys-primary/10 border border-sys-primary"
				: speaker === "tool"
					? "bg-sys-surface-low border border-sys-accent"
					: "bg-sys-surface-low";
	const maxWidth =
		speaker === "system" || speaker === "tool" ? "max-w-[96%]" : "max-w-[78%]";

	return (
		<div className={`flex flex-col ${align} ${maxWidth}`}>
			<div className="mb-1 flex items-baseline gap-2 text-[0.5rem] font-bold uppercase tracking-[0.1em] opacity-60">
				<span>{speaker}</span>
				{subtitle && <span className="opacity-70">{subtitle}</span>}
				{timestamp && (
					<span className="opacity-50 font-mono">
						{new Date(timestamp).toLocaleTimeString()}
					</span>
				)}
			</div>
			<div
				className={`px-3 py-2 text-[0.75rem] font-mono leading-relaxed ${bg}`}
			>
				{children}
			</div>
		</div>
	);
}
