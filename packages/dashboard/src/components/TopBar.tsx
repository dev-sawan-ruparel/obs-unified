import { useEffect, useMemo, useRef, useState } from "react";
import { useDashboard } from "../provider";

const TIME_OPTIONS: Array<{ label: string; mins: number }> = [
	{ label: "15m", mins: 15 },
	{ label: "1h", mins: 60 },
	{ label: "6h", mins: 360 },
	{ label: "24h", mins: 1440 },
	{ label: "7d", mins: 10080 },
	{ label: "30d", mins: 43200 },
];

function formatWindow(mins: number): string {
	const match = TIME_OPTIONS.find((o) => o.mins === mins);
	if (match) return match.label;
	if (mins < 60) return `${mins}m`;
	if (mins < 1440) return `${Math.round(mins / 60)}h`;
	return `${Math.round(mins / 1440)}d`;
}

const PALETTE_DESTINATIONS: Array<{
	tab: string;
	label: string;
	group: string;
}> = [
	{ tab: "timeline", label: "Timeline", group: "Observe" },
	{ tab: "service-map", label: "Service map", group: "Observe" },
	{ tab: "logs", label: "Logs", group: "Observe" },
	{ tab: "traces", label: "Traces", group: "Investigate" },
	{ tab: "issues", label: "Issues", group: "Investigate" },
	{ tab: "ai", label: "AI calls", group: "Investigate" },
	{ tab: "replay", label: "Replays", group: "Experience" },
	{ tab: "alerts", label: "Alerts", group: "Operate" },
	{ tab: "usage", label: "Usage", group: "Operate" },
	{ tab: "resources", label: "Resources", group: "Operate" },
	{ tab: "projects", label: "Projects", group: "Settings" },
	{ tab: "playground", label: "Playground", group: "Settings" },
];

/**
 * Compact ⌘K-style command palette launcher. Replaces a free-text "global
 * search" that only competed visually with each dashboard's own filter.
 * Currently scoped to tab navigation; structured to grow into a proper
 * jump-to-anything search later.
 */
export function GlobalSearch() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIdx, setActiveIdx] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				setOpen((v) => !v);
			} else if (e.key === "Escape" && open) {
				setOpen(false);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActiveIdx(0);
		const t = setTimeout(() => inputRef.current?.focus(), 10);
		return () => clearTimeout(t);
	}, [open]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return PALETTE_DESTINATIONS;
		return PALETTE_DESTINATIONS.filter(
			(d) =>
				d.label.toLowerCase().includes(q) ||
				d.group.toLowerCase().includes(q) ||
				d.tab.toLowerCase().includes(q),
		);
	}, [query]);

	const navigate = (tab: string) => {
		window.location.hash = `/${tab}`;
		setOpen(false);
	};

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				title="Open command palette (⌘K)"
				className="flex h-8 min-w-[180px] items-center gap-2 bg-sys-surface-low px-2.5 text-left text-[0.8125rem] text-sys-on-surface-subtle hover:bg-sys-surface-high"
			>
				<span aria-hidden className="text-[0.875rem]">
					⌕
				</span>
				<span className="flex-1">Jump to…</span>
				<kbd className="font-mono text-[0.6875rem] text-sys-on-surface-subtle">
					⌘K
				</kbd>
			</button>
			{open && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[15vh]"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) setOpen(false);
					}}
				>
					<div className="flex w-[480px] max-w-[90vw] flex-col bg-sys-surface shadow-xl">
						<input
							ref={inputRef}
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setActiveIdx(0);
							}}
							onKeyDown={(e) => {
								if (e.key === "ArrowDown") {
									e.preventDefault();
									setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
								} else if (e.key === "ArrowUp") {
									e.preventDefault();
									setActiveIdx((i) => Math.max(0, i - 1));
								} else if (e.key === "Enter") {
									e.preventDefault();
									const dest = filtered[activeIdx];
									if (dest) navigate(dest.tab);
								}
							}}
							placeholder="Jump to a tab…"
							className="h-12 w-full bg-transparent px-4 text-[0.9375rem] text-sys-on-surface placeholder:text-sys-on-surface-subtle focus:outline-none border-b border-sys-outline-soft"
						/>
						<div className="max-h-[50vh] overflow-y-auto py-1">
							{filtered.length === 0 && (
								<div className="px-4 py-3 text-[0.8125rem] text-sys-on-surface-subtle">
									No matches.
								</div>
							)}
							{filtered.map((d, i) => (
								<button
									key={d.tab}
									type="button"
									onMouseEnter={() => setActiveIdx(i)}
									onClick={() => navigate(d.tab)}
									className={`flex w-full items-center justify-between px-4 py-2 text-left text-[0.8125rem] ${
										i === activeIdx
											? "bg-sys-surface-low text-sys-on-surface"
											: "text-sys-on-surface-muted"
									}`}
								>
									<span>{d.label}</span>
									<span className="text-[0.6875rem] text-sys-on-surface-subtle">
										{d.group}
									</span>
								</button>
							))}
						</div>
						<div className="flex items-center gap-3 border-t border-sys-outline-soft px-4 py-2 text-[0.6875rem] text-sys-on-surface-subtle">
							<span>
								<kbd className="font-mono">↑↓</kbd> navigate
							</span>
							<span>
								<kbd className="font-mono">↵</kbd> open
							</span>
							<span>
								<kbd className="font-mono">esc</kbd> close
							</span>
						</div>
					</div>
				</div>
			)}
		</>
	);
}

export function TimeRangePicker() {
	const { timeWindowMins, setTimeWindowMins } = useDashboard();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const onDocClick = (e: MouseEvent) => {
			if (!ref.current) return;
			if (!ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onDocClick);
		return () => document.removeEventListener("mousedown", onDocClick);
	}, [open]);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex h-8 items-center gap-1.5 bg-sys-surface-low px-2.5 text-[0.8125rem] font-medium text-sys-on-surface hover:bg-sys-surface-high"
			>
				<span aria-hidden className="text-sys-on-surface-subtle">
					◷
				</span>
				<span className="tabular-nums">{formatWindow(timeWindowMins)}</span>
				<span aria-hidden className="text-sys-on-surface-subtle">
					▾
				</span>
			</button>
			{open && (
				<div className="absolute right-0 top-full z-20 mt-1 flex min-w-[120px] flex-col border border-sys-outline-soft bg-sys-surface shadow-lg">
					{TIME_OPTIONS.map((opt) => {
						const active = opt.mins === timeWindowMins;
						return (
							<button
								key={opt.mins}
								type="button"
								onClick={() => {
									setTimeWindowMins(opt.mins);
									setOpen(false);
								}}
								className={`flex items-center justify-between px-3 py-1.5 text-left text-[0.8125rem] ${
									active
										? "bg-sys-surface-low font-semibold text-sys-on-surface"
										: "text-sys-on-surface-muted hover:bg-sys-surface-low hover:text-sys-on-surface"
								}`}
							>
								<span>Last {opt.label}</span>
								{active && (
									<span aria-hidden className="text-sys-primary">
										•
									</span>
								)}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
