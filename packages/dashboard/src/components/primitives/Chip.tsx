import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

// ── Chip (clickable filter token) ──

export function Chip({
	children,
	active,
	onClick,
	onClear,
	tone = "default",
}: {
	children: ReactNode;
	active?: boolean;
	onClick?: () => void;
	onClear?: () => void;
	tone?: "default" | "primary" | "accent" | "warning" | "error";
}) {
	const toneClass =
		tone === "primary"
			? "bg-sys-primary text-sys-on-primary"
			: tone === "accent"
				? "bg-sys-accent text-sys-on-accent"
				: tone === "warning"
					? "bg-sys-warning text-sys-on-warning"
					: tone === "error"
						? "bg-sys-error text-sys-on-error"
						: active
							? "bg-sys-surface-low text-sys-on-surface border border-sys-primary"
							: "bg-sys-surface-low text-sys-on-surface border border-sys-outline";
	const handleKeyDown = onClick
		? (event: ReactKeyboardEvent<HTMLButtonElement>) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onClick();
				}
			}
		: undefined;
	const Wrapper = onClick ? "button" : "span";
	return (
		<Wrapper
			type={onClick ? "button" : undefined}
			className={`inline-flex items-center gap-1 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${toneClass} ${
				onClick ? "cursor-pointer hover:opacity-80" : ""
			}`}
			onClick={onClick}
			onKeyDown={handleKeyDown}
		>
			{children}
			{onClear && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onClear();
					}}
					className="ml-1 opacity-70 hover:opacity-100 cursor-pointer"
					aria-label="Clear"
				>
					×
				</button>
			)}
		</Wrapper>
	);
}
