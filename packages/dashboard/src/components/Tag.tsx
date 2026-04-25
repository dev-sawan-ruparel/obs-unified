import type { ReactNode } from "react";

export type TagTone =
	| "neutral"
	| "primary"
	| "accent"
	| "warning"
	| "error"
	| "muted";

const TONE: Record<TagTone, string> = {
	neutral: "bg-sys-surface-low text-sys-on-surface",
	primary: "bg-sys-primary text-white",
	accent: "bg-sys-accent text-white",
	warning: "bg-sys-warning text-white",
	error: "bg-sys-error text-white",
	muted: "bg-sys-surface-low text-sys-on-surface-muted",
};

/**
 * 10px UPPERCASE section-label tag — the only place uppercase belongs
 * in this design system. Used for status pills (ACTIVE / FIRING / OFF /
 * REVOKED / SQLITE / OBJECT / PENDING AUTH / LIVE), section markers,
 * and table-header columns.
 *
 * If you want a clickable filter chip with sentence case, use <Chip>
 * from primitives instead.
 */
export function Tag({
	children,
	tone = "neutral",
	className = "",
	pulse,
}: {
	children: ReactNode;
	tone?: TagTone;
	className?: string;
	/** Animate the tag (e.g. for FIRING). */
	pulse?: boolean;
}) {
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.1em] ${TONE[tone]} ${
				pulse ? "animate-pulse" : ""
			} ${className}`}
		>
			{children}
		</span>
	);
}
