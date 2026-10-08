import {
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useRef,
	useState,
} from "react";
import { Card } from "./layout";

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
			const idx = Math.min(
				n - 1,
				Math.max(0, Math.round((x / rect.width) * (n - 1))),
			);
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
				<line
					x1={0}
					x2={W}
					y1={H - 1}
					y2={H - 1}
					stroke={color}
					strokeOpacity="0.2"
					strokeWidth="1"
				/>
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
			role="img"
			aria-label="Sparkline"
			className="relative h-full w-full"
			onMouseMove={onMove}
			onMouseLeave={onLeave}
		>
			<svg
				aria-label="Sparkline path"
				role="img"
				viewBox={`0 0 ${W} ${H}`}
				preserveAspectRatio="none"
				style={svgStyle}
			>
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
