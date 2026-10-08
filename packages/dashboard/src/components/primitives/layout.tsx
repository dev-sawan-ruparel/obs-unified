import type { ReactNode } from "react";

// ── Section title ──

export function SectionTitle({
	title,
	note,
	right,
}: {
	title: string;
	note?: string;
	right?: ReactNode;
}) {
	return (
		<div className="mb-1 flex flex-none items-baseline gap-3">
			<span className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-sys-on-surface">
				{title}
			</span>
			{note && (
				<span className="text-[0.625rem] font-mono uppercase opacity-50">
					{note}
				</span>
			)}
			{right && <div className="ml-auto">{right}</div>}
		</div>
	);
}

// ── Card ──

export function Card({
	children,
	className = "",
	accent,
}: {
	children: ReactNode;
	className?: string;
	accent?: "default" | "primary" | "error" | "warning" | "accent";
}) {
	const accentBorder =
		accent === "primary"
			? "border-l-[3px] border-l-sys-primary"
			: accent === "error"
				? "border-l-[3px] border-l-sys-error"
				: accent === "warning"
					? "border-l-[3px] border-l-sys-warning"
					: accent === "accent"
						? "border-l-[3px] border-l-sys-accent"
						: "";
	return (
		<div
			className={`bg-sys-surface border border-[#E5E7E3] ${accentBorder} ${className}`}
		>
			{children}
		</div>
	);
}
