import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant =
	| "primary"
	| "ghost"
	| "danger"
	| "warning"
	| "accent";
export type ButtonSize = "md" | "sm" | "xs";

const SIZE: Record<ButtonSize, string> = {
	md: "h-8 px-3 text-[0.8125rem]",
	sm: "h-7 px-2.5 text-[0.75rem]",
	xs: "h-6 px-2 text-[0.6875rem]",
};

const VARIANT: Record<ButtonVariant, string> = {
	primary: "bg-sys-primary text-white font-semibold hover:bg-micro-gradient",
	ghost:
		"bg-transparent text-sys-on-surface-muted font-medium outline outline-[1px] outline-sys-outline hover:bg-sys-surface-low hover:text-sys-on-surface",
	danger: "bg-sys-error text-white font-semibold hover:opacity-90",
	warning: "bg-sys-warning text-white font-semibold hover:opacity-90",
	accent: "bg-sys-accent text-white font-semibold hover:bg-micro-gradient",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
	/** Render as the active state of a toggle (e.g. Live tail on). */
	active?: boolean;
	/** Override the active-state className when `active` is true. */
	activeClassName?: string;
	children: ReactNode;
}

/**
 * Single source of truth for button chrome. Replaces the dozens of
 * hand-rolled `px-3 py-1.5 text-[0.875rem] font-bold uppercase ...`
 * strings that used to live in every dashboard.
 *
 * Variants:
 *   - primary: solid green CTA (Refresh, Submit, Load…)
 *   - ghost:   outlined / secondary (Search, Export, Cancel…)
 *   - danger:  solid red (Delete, Stop, Crash…)
 *   - warning: amber (Pause, Conditional warnings…)
 *   - accent:  blue (alt CTA, e.g. "Open replay")
 *
 * Sizes mirror our type scale: md=13px, sm=12px, xs=11px.
 */
export function Button({
	variant = "ghost",
	size = "md",
	active,
	activeClassName,
	className = "",
	children,
	type = "button",
	...rest
}: ButtonProps) {
	const cls = [
		"inline-flex items-center justify-center gap-1.5",
		"transition-none cursor-pointer",
		"disabled:opacity-40 disabled:cursor-not-allowed",
		SIZE[size],
		active && activeClassName ? activeClassName : VARIANT[variant],
		className,
	]
		.filter(Boolean)
		.join(" ");
	return (
		<button type={type} className={cls} {...rest}>
			{children}
		</button>
	);
}
