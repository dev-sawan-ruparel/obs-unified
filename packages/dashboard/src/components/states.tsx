import type { ReactNode } from "react";

/**
 * Block-style empty state — for "No traces found.", "No rules yet.",
 * etc. inline inside a dashboard panel. Sentence case body.
 */
export function EmptyState({
	title,
	description,
	action,
	tone = "default",
	className = "",
}: {
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	tone?: "default" | "muted";
	className?: string;
}) {
	const titleColor =
		tone === "muted" ? "text-sys-on-surface-muted" : "text-sys-on-surface";
	return (
		<div
			className={`flex flex-col items-center justify-center gap-2 px-4 py-8 ${className}`}
		>
			<p className={`text-[0.875rem] font-medium ${titleColor}`}>{title}</p>
			{description && (
				<p className="text-[0.8125rem] text-sys-on-surface-subtle">
					{description}
				</p>
			)}
			{action}
		</div>
	);
}

/**
 * Inline single-row "Loading…" / "Initializing…" / "No data" message
 * for use inside table bodies or panel headers. One line, muted.
 */
export function StateRow({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`px-3 py-3 text-[0.8125rem] text-sys-on-surface-muted ${className}`}
		>
			{children}
		</div>
	);
}
