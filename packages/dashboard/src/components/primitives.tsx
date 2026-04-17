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
	const accentClass =
		accent === "primary"
			? "border-l-[3px] border-sys-primary"
			: accent === "error"
				? "border-l-[3px] border-sys-error"
				: accent === "warning"
					? "border-l-[3px] border-sys-warning"
					: accent === "accent"
						? "border-l-[3px] border-sys-accent"
						: "";
	return (
		<div
			className={`bg-sys-surface ${accentClass} outline outline-1 outline-sys-outline-soft ${className}`}
		>
			{children}
		</div>
	);
}

// ── Stat with optional micro-sparkline ──

export function Stat({
	label,
	value,
	accent = "default",
	spark,
	footer,
	note,
}: {
	label: string;
	value: string | number;
	accent?: "default" | "primary" | "error" | "warning" | "accent";
	spark?: number[];
	footer?: string;
	note?: string;
}) {
	const valueColor =
		accent === "error"
			? "text-sys-error"
			: accent === "warning"
				? "text-sys-warning"
				: accent === "primary"
					? "text-sys-primary"
					: accent === "accent"
						? "text-sys-accent"
						: "text-sys-on-surface";
	const sparkColor =
		accent === "error"
			? "var(--color-sys-error)"
			: accent === "warning"
				? "var(--color-sys-warning)"
				: accent === "accent"
					? "var(--color-sys-accent)"
					: "var(--color-sys-primary)";
	return (
		<Card accent={accent} className="flex flex-col justify-between px-3 py-2.5 gap-2 min-h-[92px]">
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-[0.625rem] font-bold uppercase tracking-[0.1em] opacity-70">
					{label}
				</span>
				{note && (
					<span className="text-[0.625rem] font-mono uppercase opacity-50">
						{note}
					</span>
				)}
			</div>
			<div
				className={`font-mono text-[1.75rem] font-light leading-none tracking-tight ${valueColor}`}
			>
				{value}
			</div>
			<div className="h-[28px] w-full">
				{spark && spark.length > 0 ? (
					<MicroSpark data={spark} color={sparkColor} />
				) : (
					<div className="h-full w-full" aria-hidden />
				)}
			</div>
			{footer && (
				<div className="text-[0.625rem] font-mono uppercase opacity-60">
					{footer}
				</div>
			)}
		</Card>
	);
}

// ── Micro sparkline (path-based, area fill) ──

function MicroSpark({ data, color }: { data: number[]; color: string }) {
	const W = 200;
	const H = 28;
	const max = Math.max(...data, 1);
	const min = Math.min(...data, 0);
	const range = Math.max(1, max - min);
	const n = data.length;

	if (n === 1) {
		// Single point — render a dot on a baseline.
		return (
			<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
				<line x1={0} x2={W} y1={H - 1} y2={H - 1} stroke={color} strokeOpacity="0.2" strokeWidth="1" />
				<circle cx={W / 2} cy={H / 2} r="2" fill={color} />
			</svg>
		);
	}

	const step = W / (n - 1);
	const points = data
		.map((v, i) => {
			const x = i * step;
			const y = H - ((v - min) / range) * (H - 2) - 1;
			return `${x.toFixed(2)},${y.toFixed(2)}`;
		})
		.join(" ");
	const areaPoints = `0,${H} ${points} ${W},${H}`;

	return (
		<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
			<polygon points={areaPoints} fill={color} fillOpacity="0.15" />
			<polyline points={points} stroke={color} strokeWidth="1.25" fill="none" strokeLinejoin="round" strokeLinecap="round" />
		</svg>
	);
}

// ── Timeseries bars (for "page views over time", "requests per minute", etc.) ──

export function TimeSeriesBars({
	data,
	height = 96,
	color = "var(--color-sys-primary)",
}: {
	data: Array<{ t: string; v: number }>;
	height?: number;
	color?: string;
}) {
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
	const first = data[0]?.t;
	const last = data[data.length - 1]?.t;
	return (
		<div className="flex flex-col gap-1" style={{ minHeight: height + 18 }}>
			<div className="flex items-end gap-[1px]" style={{ height }}>
				{data.map((d, i) => {
					const h = (d.v / max) * (height - 2);
					return (
						<div
							key={`${d.t}-${i}`}
							className="group relative flex-1 min-w-[2px] h-full flex items-end"
							title={`${new Date(d.t).toLocaleString()}: ${d.v}`}
						>
							{d.v > 0 ? (
								<div
									className="w-full transition-none"
									style={{
										height: `${Math.max(2, h)}px`,
										backgroundColor: color,
										opacity: 0.7,
									}}
								/>
							) : (
								<div className="w-full h-[1px]" style={{ backgroundColor: color, opacity: 0.15 }} />
							)}
						</div>
					);
				})}
			</div>
			<div className="flex justify-between text-[0.5rem] font-mono uppercase opacity-40">
				<span>{first ? new Date(first).toLocaleTimeString([], { month: "short", day: "numeric", hour: "numeric" }) : ""}</span>
				<span>peak {max}</span>
				<span>{last ? new Date(last).toLocaleTimeString([], { month: "short", day: "numeric", hour: "numeric" }) : ""}</span>
			</div>
		</div>
	);
}

// ── BarList (label + value with proper separation) ──

export function BarList({
	title,
	items,
	color = "var(--color-sys-primary)",
	compact = false,
}: {
	title: string;
	items: Array<[label: string, value: number]>;
	color?: string;
	compact?: boolean;
}) {
	if (items.length === 0) return null;
	const max = Math.max(...items.map(([, v]) => v), 1);
	const rowGap = compact ? "mb-1.5" : "mb-2.5";
	return (
		<Card className="flex flex-col p-3 min-w-0">
			<SectionTitle title={title} />
			<div className="flex flex-col mt-1">
				{items.slice(0, 8).map(([label, value]) => (
					<div key={label} className={rowGap}>
						<div className="flex items-baseline justify-between gap-3 mb-1">
							<span className="min-w-0 flex-1 truncate text-[0.75rem] font-bold">
								{label}
							</span>
							<span className="flex-none font-mono text-[0.75rem] opacity-70 tabular-nums">
								{value.toLocaleString()}
							</span>
						</div>
						<div className="h-[3px] w-full bg-sys-surface-low">
							<div
								className="h-full"
								style={{
									width: `${(value / max) * 100}%`,
									backgroundColor: color,
									opacity: 0.85,
								}}
							/>
						</div>
					</div>
				))}
			</div>
		</Card>
	);
}

// ── UpdatedChip (replaces misleading "CONNECTED") ──

export function UpdatedChip({ at }: { at: string | null }) {
	const text = at ? freshness(at) : "—";
	const fresh = at
		? Date.now() - new Date(at).getTime() < 30_000
		: false;
	return (
		<div className="flex items-center gap-2 bg-sys-surface-low px-2 py-1">
			<span
				className={`block h-[6px] w-[6px] ${fresh ? "bg-sys-primary" : "bg-sys-outline"}`}
				aria-hidden
			/>
			<span className="text-[0.625rem] font-bold uppercase tracking-[0.1em] opacity-70">
				Updated {text}
			</span>
		</div>
	);
}

function freshness(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	const s = Math.floor(ms / 1000);
	if (s < 5) return "just now";
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}

// ── Time-binning helpers ──

export function binByInterval(
	timestamps: string[],
	windowMins: number,
	bucketCount = 24,
): number[] {
	if (timestamps.length === 0) return new Array(bucketCount).fill(0);
	const now = Date.now();
	const bucketMs = (windowMins * 60 * 1000) / bucketCount;
	const start = now - windowMins * 60 * 1000;
	const buckets = new Array(bucketCount).fill(0);
	for (const ts of timestamps) {
		const t = new Date(ts).getTime();
		if (Number.isNaN(t)) continue;
		if (t < start || t > now) continue;
		const idx = Math.min(bucketCount - 1, Math.floor((t - start) / bucketMs));
		buckets[idx]++;
	}
	return buckets;
}
