import {
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";

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
		<Card
			accent={accent}
			className="flex flex-col justify-between px-3 py-2.5 gap-1.5"
			// min-height kept via inline so Tailwind arbitrary values aren't required
		>
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
			<div style={{ height: 32, width: "100%" }}>
				{spark && spark.length > 0 ? (
					<MicroSpark data={spark} color={sparkColor} />
				) : (
					<div style={{ height: 32 }} aria-hidden />
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

// ── Micro sparkline (path-based, area fill, with hover) ──

function MicroSpark({ data, color }: { data: number[]; color: string }) {
	const W = 200;
	const H = 32;
	const n = data.length;
	const max = Math.max(...data, 1);
	const min = Math.min(...data, 0);
	const range = Math.max(1, max - min);

	const containerRef = useRef<HTMLDivElement | null>(null);
	const [hover, setHover] = useState<number | null>(null);

	const onMove = useCallback(
		(e: ReactMouseEvent<HTMLDivElement>) => {
			const el = containerRef.current;
			if (!el || n === 0) return;
			const rect = el.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const idx = Math.min(n - 1, Math.max(0, Math.round((x / rect.width) * (n - 1))));
			setHover(idx);
		},
		[n],
	);
	const onLeave = useCallback(() => setHover(null), []);

	// Explicit width/height + display:block so browsers never give the SVG an
	// implicit aspect ratio that stretches it to match the container width.
	const svgStyle = {
		display: "block",
		width: "100%",
		height: "100%",
	} as const;

	// Build path data.
	let svgBody: ReactNode;
	if (n === 1) {
		svgBody = (
			<>
				<line x1={0} x2={W} y1={H - 1} y2={H - 1} stroke={color} strokeOpacity="0.2" strokeWidth="1" />
				<circle cx={W / 2} cy={H / 2} r="2" fill={color} />
			</>
		);
	} else {
		const step = W / (n - 1);
		const points = data
			.map((v, i) => {
				const xp = i * step;
				const yp = H - ((v - min) / range) * (H - 2) - 1;
				return `${xp.toFixed(2)},${yp.toFixed(2)}`;
			})
			.join(" ");
		const areaPoints = `0,${H} ${points} ${W},${H}`;
		svgBody = (
			<>
				<polygon points={areaPoints} fill={color} fillOpacity="0.15" />
				<polyline
					points={points}
					stroke={color}
					strokeWidth="1.25"
					fill="none"
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
				{hover !== null && (
					<circle
						cx={hover * step}
						cy={H - ((data[hover] - min) / range) * (H - 2) - 1}
						r="2.5"
						fill={color}
					/>
				)}
			</>
		);
	}

	const hoverPct = hover !== null && n > 1 ? (hover / (n - 1)) * 100 : null;

	return (
		<div
			ref={containerRef}
			className="relative h-full w-full"
			onMouseMove={onMove}
			onMouseLeave={onLeave}
		>
			<svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={svgStyle}>
				{svgBody}
			</svg>
			{hover !== null && hoverPct !== null && (
				<div
					className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap bg-sys-on-surface px-1.5 py-0.5 font-mono text-[0.625rem] font-bold text-sys-bg"
					style={{ left: `${hoverPct}%` }}
				>
					{data[hover].toLocaleString()}
				</div>
			)}
		</div>
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
	const tickIdx = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];

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
				className="relative flex items-end gap-[1px] bg-[linear-gradient(to_top,rgba(0,0,0,0.04)_1px,transparent_1px)] bg-[length:100%_25%]"
				style={{ height }}
				onMouseLeave={() => setHover(null)}
			>
				{data.map((d, i) => {
					const h = (d.v / max) * (height - 2);
					const isHover = hover === i;
					return (
						<div
							key={`${d.t}-${i}`}
							className="relative flex-1 min-w-[2px] h-full flex items-end"
							onMouseEnter={() => setHover(i)}
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
						</div>
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
							{bucketMs > 0 && (
								<> · {formatDuration(bucketMs)} bucket</>
							)}
						</div>
					</div>
				)}
			</div>

			{/* X-axis tick labels */}
			<div className="relative text-[0.5rem] font-mono uppercase opacity-50 select-none" style={{ height: 12 }}>
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

// ── Percentile helper ──

/** Linear-interpolated percentile. `p` is 0..1. Returns 0 for empty input. */
export function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = (sorted.length - 1) * p;
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo]!;
	const w = idx - lo;
	return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

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
			? "bg-sys-primary text-white"
			: tone === "accent"
				? "bg-sys-accent text-white"
				: tone === "warning"
					? "bg-sys-warning text-black"
					: tone === "error"
						? "bg-sys-error text-white"
						: active
							? "bg-sys-surface-low text-sys-on-surface border border-sys-primary"
							: "bg-sys-surface-low text-sys-on-surface border border-sys-outline";
	return (
		<span
			className={`inline-flex items-center gap-1 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${toneClass} ${
				onClick ? "cursor-pointer hover:opacity-80" : ""
			}`}
			onClick={onClick}
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
		</span>
	);
}

// ── JsonBlock: pretty-prints JSON, collapsible, copy-to-clipboard ──

const PREVIEW_CHARS = 280;

export function JsonBlock({
	value,
	label,
	accent,
	maxHeight = 220,
}: {
	value: string | null | undefined;
	label?: string;
	accent?: "primary" | "error" | "accent" | "default";
	maxHeight?: number;
}) {
	const [expanded, setExpanded] = useState(false);
	const [copied, setCopied] = useState(false);

	if (!value) {
		return (
			<div className="flex flex-col">
				{label && <BlockLabel>{label}</BlockLabel>}
				<div className="bg-sys-surface-low p-2 text-[0.75rem] opacity-50 italic border-l-[3px] border-sys-outline">
					empty
				</div>
			</div>
		);
	}

	const borderClass =
		accent === "error"
			? "border-sys-error text-sys-error"
			: accent === "accent"
				? "border-sys-accent text-sys-on-surface"
				: "border-sys-primary text-sys-on-surface";

	const pretty = useMemo(() => tryPrettyJson(value), [value]);
	const raw = pretty ?? value;
	const isLong = raw.length > PREVIEW_CHARS;
	const visible = expanded || !isLong ? raw : `${raw.slice(0, PREVIEW_CHARS)}…`;

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(raw);
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		} catch {
			// noop — clipboard unavailable (e.g. http context)
		}
	};

	return (
		<div className="flex flex-col min-w-0">
			{label && (
				<div className="flex items-center justify-between gap-2 mb-1">
					<BlockLabel>{label}</BlockLabel>
					<div className="flex items-center gap-2">
						{pretty && (
							<span className="text-[0.5rem] font-bold uppercase tracking-[0.05em] opacity-40">
								JSON
							</span>
						)}
						<button
							type="button"
							onClick={onCopy}
							className="text-[0.5rem] font-bold uppercase tracking-[0.05em] opacity-60 hover:opacity-100 cursor-pointer"
						>
							{copied ? "✓ copied" : "copy"}
						</button>
					</div>
				</div>
			)}
			<pre
				className={`bg-sys-surface-low p-2 text-[0.6875rem] leading-relaxed border-l-[3px] break-all whitespace-pre-wrap font-mono overflow-y-auto ${borderClass}`}
				style={{ maxHeight: expanded ? maxHeight * 2 : maxHeight }}
			>
				{visible}
			</pre>
			{isLong && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="mt-1 text-[0.5rem] font-bold uppercase tracking-[0.05em] opacity-60 hover:opacity-100 cursor-pointer self-start"
				>
					{expanded ? "▴ collapse" : `▾ expand (${raw.length.toLocaleString()} chars)`}
				</button>
			)}
		</div>
	);
}

function BlockLabel({ children }: { children: ReactNode }) {
	return (
		<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">
			{children}
		</div>
	);
}

function tryPrettyJson(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2);
	} catch {
		return null;
	}
}

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

// ── Chat bubble: for conversation-style session thread ──

export function ChatBubble({
	role,
	children,
	timestamp,
	subtitle,
	accent,
}: {
	role: "user" | "assistant" | "system" | "tool";
	children: ReactNode;
	timestamp?: string;
	subtitle?: string;
	accent?: "primary" | "accent" | "warning" | "error";
}) {
	const align =
		role === "user" ? "self-start" : role === "assistant" ? "self-end" : "self-center";
	const bg =
		role === "user"
			? "bg-sys-surface"
			: role === "assistant"
				? accent === "error"
					? "bg-sys-error/10 border border-sys-error"
					: "bg-sys-primary/10 border border-sys-primary"
				: role === "tool"
					? "bg-sys-surface-low border border-sys-accent"
					: "bg-sys-surface-low";
	const maxWidth = role === "system" || role === "tool" ? "max-w-[96%]" : "max-w-[78%]";

	return (
		<div className={`flex flex-col ${align} ${maxWidth}`}>
			<div className="mb-1 flex items-baseline gap-2 text-[0.5rem] font-bold uppercase tracking-[0.1em] opacity-60">
				<span>{role}</span>
				{subtitle && <span className="opacity-70">{subtitle}</span>}
				{timestamp && (
					<span className="opacity-50 font-mono">
						{new Date(timestamp).toLocaleTimeString()}
					</span>
				)}
			</div>
			<div className={`px-3 py-2 text-[0.75rem] font-mono leading-relaxed ${bg}`}>
				{children}
			</div>
		</div>
	);
}
