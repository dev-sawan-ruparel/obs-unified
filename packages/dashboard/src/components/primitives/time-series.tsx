import { useState } from "react";

// ── Timeseries bars (for "page views over time", "requests per minute", etc.) ──

export function TimeSeriesBars({
	data,
	title = "Timeseries",
	height = 96,
	color = "var(--color-sys-primary)",
}: {
	data: Array<{ t: string; v: number }>;
	title?: string;
	height?: number;
	color?: string;
}) {
	const [hover, setHover] = useState<number | null>(null);

	if (data.length === 0) {
		return (
			<div
				className="flex items-center justify-center text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-40"
				style={{ height }}
			>
				NO DATA IN WINDOW
			</div>
		);
	}

	const max = Math.max(...data.map((d) => d.v), 1);
	const total = data.reduce((s, d) => s + d.v, 0);
	const n = data.length;
	const first = data[0]?.t;
	const last = data[n - 1]?.t;

	// Bucket duration in ms (used for "covers X–Y" tooltip label).
	const bucketMs =
		n > 1 && first && last
			? (new Date(last).getTime() - new Date(first).getTime()) / (n - 1)
			: 0;

	// X-axis ticks: 4 evenly-spaced timestamps (0%, 33%, 67%, 100% of window).
	const tickIdx = Array.from(
		new Set([0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1]),
	);

	const fmtTime = (iso: string) => {
		const d = new Date(iso);
		return d.toLocaleTimeString([], {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
	};

	return (
		<div className="flex flex-col gap-1.5">
			{/* Top row: hover readout on the right, peak on the left */}
			<div className="flex items-baseline justify-between text-[0.625rem] font-mono uppercase opacity-60">
				<span>
					{n} buckets · total {total.toLocaleString()}
				</span>
				<span>
					{hover !== null ? (
						<>
							<span className="font-bold text-sys-on-surface">
								{data[hover].v.toLocaleString()}
							</span>{" "}
							at {fmtTime(data[hover].t)}
						</>
					) : (
						<>peak {max.toLocaleString()}</>
					)}
				</span>
			</div>

			{/* Chart body */}
			<div
				role="img"
				aria-label={`${title} bar chart`}
				className="relative flex items-end gap-[1px] bg-[linear-gradient(to_top,rgba(0,0,0,0.04)_1px,transparent_1px)] bg-[length:100%_25%]"
				style={{ height }}
				onMouseLeave={() => setHover(null)}
			>
				{data.map((d, i) => {
					const h = (d.v / max) * (height - 2);
					const isHover = hover === i;
					return (
						<button
							type="button"
							key={d.t}
							aria-label={`${title} at ${fmtTime(d.t)}: ${d.v.toLocaleString()}`}
							className="relative flex-1 min-w-[2px] h-full flex items-end p-0 border-0 bg-transparent"
							onMouseEnter={() => setHover(i)}
							onFocus={() => setHover(i)}
						>
							{d.v > 0 ? (
								<div
									className="w-full transition-none"
									style={{
										height: `${Math.max(2, h)}px`,
										backgroundColor: color,
										opacity: isHover ? 1 : 0.72,
									}}
								/>
							) : (
								<div
									className="w-full h-[1px]"
									style={{ backgroundColor: color, opacity: 0.15 }}
								/>
							)}
							{/* Hover crosshair */}
							{isHover && (
								<div
									className="pointer-events-none absolute inset-y-0 left-1/2 w-[1px] -translate-x-1/2"
									style={{ backgroundColor: color, opacity: 0.4 }}
								/>
							)}
						</button>
					);
				})}

				{/* Floating tooltip */}
				{hover !== null && (
					<div
						className="pointer-events-none absolute z-10 whitespace-nowrap bg-sys-on-surface px-2 py-1 font-mono text-[0.625rem] font-bold text-sys-bg"
						style={{
							left: `${(hover / Math.max(1, n - 1)) * 100}%`,
							top: 0,
							transform: "translate(-50%, -110%)",
						}}
					>
						<div className="text-[0.625rem] font-bold">
							{data[hover].v.toLocaleString()}
						</div>
						<div className="text-[0.5rem] opacity-70 mt-0.5">
							{fmtTime(data[hover].t)}
							{bucketMs > 0 && <> · {formatDuration(bucketMs)} bucket</>}
						</div>
					</div>
				)}
			</div>

			{/* X-axis tick labels */}
			<div
				className="relative text-[0.5rem] font-mono uppercase opacity-50 select-none"
				style={{ height: 12 }}
			>
				{tickIdx.map((idx, i) => {
					const d = data[idx];
					if (!d) return null;
					const pct = (idx / Math.max(1, n - 1)) * 100;
					const isEdge = i === 0 || i === tickIdx.length - 1;
					return (
						<span
							key={`tick-${idx}`}
							className="absolute top-0"
							style={{
								left: `${pct}%`,
								transform:
									i === 0
										? "translateX(0)"
										: isEdge
											? "translateX(-100%)"
											: "translateX(-50%)",
							}}
						>
							{fmtTime(d.t)}
						</span>
					);
				})}
			</div>
		</div>
	);
}

function formatDuration(ms: number): string {
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	const mins = Math.round(ms / 60_000);
	if (mins < 60) return `${mins}m`;
	const hrs = Math.round(mins / 60);
	if (hrs < 24) return `${hrs}h`;
	return `${Math.round(hrs / 24)}d`;
}
