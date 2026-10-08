import { type ReactNode, useEffect, useState } from "react";

function readStored(key: string, fallback: boolean): boolean {
	if (typeof localStorage === "undefined") return fallback;
	try {
		const v = localStorage.getItem(key);
		if (v === null) return fallback;
		return v === "1";
	} catch {
		return fallback;
	}
}

function writeStored(key: string, value: boolean): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(key, value ? "1" : "0");
	} catch {
		// ignore
	}
}

/**
 * Collapsible left-docked filter panel.
 *
 * Designed to sit directly to the left of a dashboard's main content area
 * (inside the dashboard, not in the app shell). Ships only chrome —
 * callers pass filter controls as children, grouped with FilterGroup.
 */
export function FilterPanel({
	title = "Filters",
	storageKey,
	defaultCollapsed = false,
	onClear,
	children,
}: {
	title?: string;
	/** localStorage key for persisting collapsed state. Omit for in-memory state. */
	storageKey?: string;
	defaultCollapsed?: boolean;
	/** Optional clear-all handler. Shown as a "Clear" button in the header. */
	onClear?: () => void;
	children: ReactNode;
}) {
	const [collapsed, setCollapsed] = useState<boolean>(() =>
		storageKey ? readStored(storageKey, defaultCollapsed) : defaultCollapsed,
	);

	useEffect(() => {
		if (storageKey) writeStored(storageKey, collapsed);
	}, [storageKey, collapsed]);

	if (collapsed) {
		return (
			<div className="flex h-full w-8 flex-none flex-col items-center border-r border-sys-outline-soft bg-sys-surface py-2">
				<button
					type="button"
					onClick={() => setCollapsed(false)}
					title="Show filters"
					className="flex h-8 w-8 items-center justify-center text-sys-on-surface-subtle hover:text-sys-on-surface"
				>
					<span aria-hidden>»</span>
				</button>
				<span
					aria-hidden
					className="mt-2 [writing-mode:vertical-rl] rotate-180 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle"
				>
					{title}
				</span>
			</div>
		);
	}

	return (
		<aside className="flex h-full w-[240px] flex-none flex-col border-r border-sys-outline-soft bg-sys-surface">
			<div className="flex h-10 flex-none items-center justify-between border-b border-sys-outline-soft px-3">
				<span className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface">
					{title}
				</span>
				<div className="flex items-center gap-2">
					{onClear && (
						<button
							type="button"
							onClick={onClear}
							className="text-[0.625rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle hover:text-sys-on-surface"
						>
							Clear
						</button>
					)}
					<button
						type="button"
						onClick={() => setCollapsed(true)}
						title="Hide filters"
						className="text-sys-on-surface-subtle hover:text-sys-on-surface"
					>
						<span aria-hidden>«</span>
					</button>
				</div>
			</div>
			<div className="flex-1 overflow-y-auto">{children}</div>
		</aside>
	);
}

/**
 * Collapsible section inside a FilterPanel. Opens by default.
 */
export function FilterGroup({
	title,
	count,
	defaultOpen = true,
	children,
}: {
	title: string;
	/** Optional count badge (e.g. number of active filters in this group) */
	count?: number;
	defaultOpen?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div className="border-b border-sys-outline-soft">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex h-8 w-full items-center justify-between px-3 text-left text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface hover:bg-sys-surface-low"
			>
				<span className="flex items-center gap-2">
					<span>{title}</span>
					{count !== undefined && count > 0 && (
						<span className="bg-sys-primary px-1.5 py-0.5 font-mono text-[0.5rem] text-white tabular-nums">
							{count}
						</span>
					)}
				</span>
				<span aria-hidden className="text-sys-on-surface-subtle">
					{open ? "▾" : "▸"}
				</span>
			</button>
			{open && <div className="px-3 pb-3 pt-1">{children}</div>}
		</div>
	);
}
