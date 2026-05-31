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

export function ErrorState({
	title = "Failed to load",
	message,
	action,
	className = "",
}: {
	title?: string;
	message: ReactNode;
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`border-l-[4px] border-sys-error bg-sys-error/10 p-3 ${className}`}
		>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<p className="m-0 text-[0.75rem] font-bold uppercase tracking-[0.05em] text-sys-error">
						{title}
					</p>
					<p className="m-0 mt-1 break-words font-mono text-[0.8125rem] text-sys-error">
						{message}
					</p>
				</div>
				{action}
			</div>
		</div>
	);
}
