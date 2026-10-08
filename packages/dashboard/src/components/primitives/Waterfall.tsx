// ── Waterfall: gantt-style timing visualization for a span tree ──

export interface WaterfallSpan {
	spanId: string;
	parentSpanId: string | null;
	startTime: string;
	endTime: string;
	durationMs: number;
	label: string;
	/** Tailwind bg-* class for the bar */
	color: string;
	/** Optional click handler to jump to details */
	onClick?: () => void;
	isError?: boolean;
}

export function Waterfall({
	spans,
	height = 18,
	rowGap = 2,
}: {
	spans: WaterfallSpan[];
	height?: number;
	rowGap?: number;
}) {
	if (spans.length === 0) return null;

	// Compute window
	const times = spans.map((s) => new Date(s.startTime).getTime());
	const ends = spans.map((s) => new Date(s.endTime).getTime());
	const windowStart = Math.min(...times);
	const windowEnd = Math.max(...ends, windowStart + 1);
	const windowMs = Math.max(1, windowEnd - windowStart);

	return (
		<div className="flex flex-col gap-[2px]">
			{spans.map((s) => {
				const start = new Date(s.startTime).getTime();
				const end = new Date(s.endTime).getTime();
				const leftPct = ((start - windowStart) / windowMs) * 100;
				const widthPct = Math.max(0.5, ((end - start) / windowMs) * 100);
				return (
					<button
						key={s.spanId}
						type="button"
						onClick={s.onClick}
						className="group relative flex items-center text-[0.6875rem] font-mono text-left bg-transparent cursor-pointer hover:bg-sys-surface-low transition-none"
						style={{ height: height + rowGap * 2, paddingBlock: rowGap }}
					>
						<div className="relative h-full w-full bg-sys-surface-low/30">
							<div
								className={`absolute top-0 ${s.isError ? "bg-sys-error" : s.color} opacity-90 group-hover:opacity-100`}
								style={{
									left: `${leftPct}%`,
									width: `${widthPct}%`,
									height: "100%",
								}}
							/>
							<div
								className="absolute inset-y-0 flex items-center gap-2 px-2 pointer-events-none"
								style={{ left: 0, right: 0 }}
							>
								<span className="font-bold truncate text-sys-on-surface">
									{s.label}
								</span>
								<span className="opacity-60 tabular-nums">
									{s.durationMs.toFixed(0)}ms
								</span>
							</div>
						</div>
					</button>
				);
			})}
			<div className="mt-1 flex justify-between text-[0.5rem] font-mono uppercase tracking-[0.05em] opacity-50">
				<span>0ms</span>
				<span>{(windowMs / 2).toFixed(0)}ms</span>
				<span>{windowMs.toFixed(0)}ms</span>
			</div>
		</div>
	);
}
