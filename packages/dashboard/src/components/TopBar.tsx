import { useEffect, useRef, useState } from "react";
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

export function GlobalSearch() {
	const { search, setSearch } = useDashboard();
	return (
		<label className="relative flex h-8 min-w-[220px] flex-1 items-center bg-sys-surface-low">
			<span
				aria-hidden
				className="pointer-events-none absolute left-2 text-[0.75rem] text-sys-on-surface-subtle"
			>
				⌕
			</span>
			<input
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				placeholder="Search services, traces, logs…"
				className="h-full w-full bg-transparent pl-7 pr-2 text-[0.8125rem] text-sys-on-surface placeholder:text-sys-on-surface-subtle focus:outline focus:outline-1 focus:outline-sys-primary"
			/>
		</label>
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
				<span aria-hidden className="text-sys-on-surface-subtle">◷</span>
				<span className="tabular-nums">{formatWindow(timeWindowMins)}</span>
				<span aria-hidden className="text-sys-on-surface-subtle">▾</span>
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
									<span aria-hidden className="text-sys-primary">•</span>
								)}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
