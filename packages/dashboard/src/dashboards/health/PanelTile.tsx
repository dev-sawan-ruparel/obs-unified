import type {
	AnalysisDefinition,
	AnalysisResult,
	AnalysisStatus,
} from "@obsunified/types";
import { Tag, type TagTone } from "../../components/Tag";
import { tileHref } from "./tile-href";

const STATUS_TONE: Record<AnalysisStatus, TagTone> = {
	ok: "primary",
	warn: "warning",
	critical: "error",
	unknown: "muted",
};

const STATUS_LABEL: Record<AnalysisStatus, string> = {
	ok: "OK",
	warn: "Warn",
	critical: "Critical",
	unknown: "Unknown",
};

/**
 * Format a number as a primary value. We can't know the unit here (errors %,
 * latency ms, count, etc.), so the analysis can hint via payload.unit; we
 * fall back to a reasonable numeric format.
 */
function formatPrimary(
	value: number | null,
	payload: Record<string, unknown>,
): string {
	if (value === null || value === undefined || Number.isNaN(value)) return "—";
	const unit =
		typeof payload.unit === "string" ? (payload.unit as string) : undefined;
	if (unit === "%") return `${value.toFixed(value < 10 ? 2 : 1)}%`;
	if (unit === "ms") {
		if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
		return `${value.toFixed(0)}ms`;
	}
	if (Math.abs(value) >= 1000) return value.toLocaleString();
	if (Number.isInteger(value)) return value.toString();
	return value.toFixed(2);
}

function formatFreshness(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}

/**
 * Decide whether an "increase" of the primary value is good or bad. Most
 * analyses where larger means worse (error rate, latency) get a red arrow;
 * for ok-status panels we treat any movement as neutral so we don't shout.
 */
function deltaColor(status: AnalysisStatus, deltaPct: number): string {
	if (status === "ok") return "text-sys-on-surface-muted";
	if (status === "critical") return "text-sys-error";
	if (status === "warn") return "text-sys-warning";
	if (deltaPct < 0) return "text-sys-primary";
	return "text-sys-on-surface-muted";
}

function formatDeltaPct(pct: number): string {
	const abs = Math.abs(pct);
	if (abs >= 1000) return `${pct > 0 ? "+" : "−"}${Math.round(abs)}%`;
	if (abs >= 100) return `${pct > 0 ? "+" : "−"}${abs.toFixed(0)}%`;
	return `${pct > 0 ? "+" : "−"}${abs.toFixed(1)}%`;
}

// ── Inline mini sparkline (kept tiny; full MicroSpark lives in primitives) ──
function MiniSpark({ data, color }: { data: number[]; color: string }) {
	const W = 240;
	const H = 32;
	if (data.length === 0) return null;
	if (data.length === 1) {
		return (
			<svg
				aria-label="Metric sparkline"
				role="img"
				viewBox={`0 0 ${W} ${H}`}
				preserveAspectRatio="none"
				style={{ display: "block", width: "100%", height: "100%" }}
			>
				<line
					x1={0}
					x2={W}
					y1={H / 2}
					y2={H / 2}
					stroke={color}
					strokeOpacity="0.25"
					strokeWidth="1"
				/>
				<circle cx={W / 2} cy={H / 2} r="2" fill={color} />
			</svg>
		);
	}
	const max = Math.max(...data, 1);
	const min = Math.min(...data, 0);
	const range = Math.max(1, max - min);
	const step = W / (data.length - 1);
	const points = data
		.map((v, i) => {
			const xp = i * step;
			const yp = H - ((v - min) / range) * (H - 2) - 1;
			return `${xp.toFixed(2)},${yp.toFixed(2)}`;
		})
		.join(" ");
	const areaPoints = `0,${H} ${points} ${W},${H}`;
	return (
		<svg
			aria-label="Metric sparkline"
			role="img"
			viewBox={`0 0 ${W} ${H}`}
			preserveAspectRatio="none"
			style={{ display: "block", width: "100%", height: "100%" }}
		>
			<polygon points={areaPoints} fill={color} fillOpacity="0.15" />
			<polyline
				points={points}
				stroke={color}
				strokeWidth="1.25"
				fill="none"
				strokeLinejoin="round"
				strokeLinecap="round"
			/>
		</svg>
	);
}

export interface PanelTileProps {
	definition: AnalysisDefinition;
	result: AnalysisResult | null;
}

/**
 * A single tile in the Health-tab grid. Renders the analysis title, status
 * pill, primary value, baseline comparison, and (when payload provides it)
 * a thin sparkline. Clicks are stubbed for Stage 1 — Stage 4 will wire them
 * to the matching investigation page.
 */
export function PanelTile({ definition, result }: PanelTileProps) {
	const status: AnalysisStatus = result?.status ?? "unknown";
	const href = tileHref(definition);

	// "Computing…" placeholder. Roughly matches the height of an active tile so
	// the grid doesn't pop when results land.
	if (result === null) {
		return (
			<a
				href={href}
				className="flex flex-col bg-sys-surface border border-sys-outline-soft min-h-[120px] cursor-pointer hover:bg-sys-surface-low no-underline text-inherit"
			>
				<div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-2">
					<span className="text-[0.875rem] font-semibold leading-snug truncate">
						{definition.title}
					</span>
					<Tag tone="muted">Pending</Tag>
				</div>
				<div className="flex flex-1 items-center justify-center px-3 pb-3 text-[0.75rem] text-sys-on-surface-subtle italic">
					computing…
				</div>
			</a>
		);
	}

	const refreshSec = definition.refreshSeconds ?? 0;
	const ageMs = Date.now() - new Date(result.generatedAt).getTime();
	const stale = refreshSec > 0 && ageMs > refreshSec * 3 * 1000;

	const sparkline = Array.isArray(result.payload?.sparkline)
		? (result.payload.sparkline as unknown[]).filter(
				(n): n is number => typeof n === "number" && Number.isFinite(n),
			)
		: null;

	const sparkColor =
		status === "critical"
			? "var(--color-sys-error)"
			: status === "warn"
				? "var(--color-sys-warning)"
				: status === "ok"
					? "var(--color-sys-primary)"
					: "var(--color-sys-on-surface-muted)";

	return (
		<a
			// Stage 1: tile click drops the user into the relevant raw-signal view
			// filtered by this analysis's scope. Stage 4 will swap this for the
			// matching investigation page (with this href as the fallback).
			href={href}
			data-test-tile-href={href}
			className="flex flex-col bg-sys-surface border border-sys-outline-soft min-h-[120px] cursor-pointer hover:bg-sys-surface-low no-underline text-inherit"
		>
			<div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-1.5">
				<span className="text-[0.875rem] font-semibold leading-snug truncate">
					{definition.title}
				</span>
				<Tag tone={STATUS_TONE[status]} pulse={status === "critical"}>
					{STATUS_LABEL[status]}
				</Tag>
			</div>
			<div className="flex flex-col gap-1 px-3 pb-2">
				<div className="font-mono text-[1.375rem] font-light leading-none tracking-tight text-sys-on-surface">
					{formatPrimary(result.primaryValue, result.payload ?? {})}
				</div>
				{result.baselineValue !== null && result.baselineValue !== undefined ? (
					<div className="flex items-baseline gap-2 text-[0.6875rem] text-sys-on-surface-muted">
						<span>
							vs{" "}
							<span className="font-mono">
								{formatPrimary(result.baselineValue, result.payload ?? {})}
							</span>{" "}
							baseline (1h)
						</span>
						{result.deltaPct !== null && result.deltaPct !== undefined ? (
							<span
								className={`font-mono font-semibold ${deltaColor(status, result.deltaPct)}`}
							>
								{result.deltaPct >= 0 ? "↑" : "↓"}{" "}
								{formatDeltaPct(result.deltaPct)}
							</span>
						) : null}
					</div>
				) : (
					<div className="text-[0.6875rem] text-sys-on-surface-subtle">
						no baseline
					</div>
				)}
			</div>
			<div className="px-3 pb-2">
				{sparkline && sparkline.length > 0 ? (
					<div style={{ height: 32 }}>
						<MiniSpark data={sparkline} color={sparkColor} />
					</div>
				) : (
					<div
						className="border-t border-sys-outline-soft"
						style={{ height: 1, marginTop: 16, marginBottom: 15 }}
					/>
				)}
			</div>
			{/* RFC 0002 Stage 3: narrative line. Sits on a left-border accent
			    in the panel's status color. No quotes, no chat bubbles. */}
			{result.narrative ? (
				<div
					className={`mx-3 mb-2 border-l-[3px] pl-2 py-0.5 text-[0.75rem] leading-snug ${narrativeBorderClass(status)} ${narrativeTextClass(status)}`}
					data-test-narrative
				>
					{result.narrative}
				</div>
			) : null}
			{stale && (
				<div className="px-3 pb-2 text-[0.625rem] text-sys-on-surface-subtle">
					updated {formatFreshness(result.generatedAt)}
				</div>
			)}
		</a>
	);
}

const narrativeBorderClass = (status: AnalysisStatus): string => {
	switch (status) {
		case "critical":
			return "border-l-sys-error";
		case "warn":
			return "border-l-sys-warning";
		case "ok":
			return "border-l-sys-primary";
		default:
			return "border-l-sys-outline";
	}
};

const narrativeTextClass = (status: AnalysisStatus): string => {
	// Slightly muted body text so the number above stays the lede, but
	// still readable. Critical narratives lean a bit darker.
	if (status === "critical") return "text-sys-on-surface";
	return "text-sys-on-surface-muted";
};
