/**
 * RFC 0007 Phase 4.7 — flame graph viewer.
 *
 * Renders an aggregated pprof profile as an inverted flame graph (root
 * at the top, leaves at the bottom). Click a frame to zoom; click the
 * 🔥 root to reset.
 *
 * Coloring follows the RFC 0009 hint that off-CPU profiles render with
 * a distinct palette so a viewer can tell at a glance whether they're
 * looking at "where CPU went" or "where the thread waited."
 */

import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "../../provider";
import { useApi } from "../../use-api";
import {
	aggregateFlameTree,
	type FlameNode,
	fetchAndDecodePprof,
	type PprofProfile,
} from "./parse-pprof";

export interface FlameGraphProps {
	/** ULID of the profile to load. */
	profileId: string;
	/** Optional — only include samples whose trace_id label matches. */
	traceIdFilter?: string;
	/** Profile type drives the palette. */
	profileType?:
		| "cpu"
		| "heap"
		| "wall"
		| "block"
		| "mutex"
		| "goroutine"
		| "offcpu";
	/** Title shown in the header — defaults to "Flame graph". */
	title?: string;
}

interface ProfileMetadata {
	id: string;
	serviceName: string | null;
	profileType: string;
	startTs: string;
	endTs: string;
	durationMs: number;
	blobSizeBytes: number;
	sampleCount: number | null;
	agent: string | null;
}

// ── Colors ────────────────────────────────────────────────────────────
//
// CPU: warm reds / oranges (Brendan Gregg's classic "hot" palette).
// Off-CPU: cool blues — the convention for "waiting" so the visual
// reads inverted from CPU at a glance.
// Heap: greens (memory).
// Other: neutral.

const CPU_PALETTE = [
	"#FF5722",
	"#FB8C00",
	"#F57C00",
	"#FFA000",
	"#FF7043",
	"#E64A19",
];
const OFF_CPU_PALETTE = [
	"#1565C0",
	"#1976D2",
	"#2196F3",
	"#42A5F5",
	"#5C6BC0",
	"#3949AB",
];
const HEAP_PALETTE = [
	"#2E7D32",
	"#388E3C",
	"#43A047",
	"#66BB6A",
	"#81C784",
	"#4CAF50",
];
const NEUTRAL_PALETTE = [
	"#607D8B",
	"#546E7A",
	"#78909C",
	"#90A4AE",
	"#455A64",
	"#37474F",
];

const paletteFor = (profileType: string | undefined): string[] => {
	if (
		profileType === "offcpu" ||
		profileType === "block" ||
		profileType === "mutex"
	)
		return OFF_CPU_PALETTE;
	if (profileType === "heap") return HEAP_PALETTE;
	if (profileType === "cpu" || profileType === "wall") return CPU_PALETTE;
	return NEUTRAL_PALETTE;
};

// Hash a function name to a stable palette index — adjacent siblings
// stay distinct without random per-render flicker.
const stableHash = (s: string): number => {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (h * 31 + s.charCodeAt(i)) | 0;
	}
	return Math.abs(h);
};

// ── Component ─────────────────────────────────────────────────────────

const ROW_HEIGHT = 18;
const MIN_FRAME_PX = 1;

interface RenderFrame extends FlameNode {
	depth: number;
	offset: number;
}

const flattenWithCoords = (root: FlameNode): RenderFrame[] => {
	const out: RenderFrame[] = [];
	const walk = (node: FlameNode, depth: number, offset: number) => {
		out.push({ ...node, depth, offset });
		const sorted = Array.from(node.children.values()).sort(
			(a, b) => b.value - a.value,
		);
		let cursor = offset;
		for (const child of sorted) {
			walk(child, depth + 1, cursor);
			cursor += child.value;
		}
	};
	walk(root, 0, 0);
	return out;
};

export function FlameGraph({
	profileId,
	traceIdFilter,
	profileType,
	title,
}: FlameGraphProps) {
	const api = useApi();
	const { basePath } = useDashboard();
	const [meta, setMeta] = useState<ProfileMetadata | null>(null);
	const [profile, setProfile] = useState<PprofProfile | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [zoomedNode, setZoomedNode] = useState<FlameNode | null>(null);
	const [hovered, setHovered] = useState<RenderFrame | null>(null);

	// Load metadata + the gzipped blob in parallel.
	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const [metaRes, fetchedProfile] = await Promise.all([
					api<{ profile: ProfileMetadata }>(
						`/profiles/${encodeURIComponent(profileId)}`,
					),
					fetchAndDecodePprof(
						`${basePath}/profiles/${encodeURIComponent(profileId)}?blob=true`,
						{ credentials: "include" },
					),
				]);
				if (cancelled) return;
				setMeta(metaRes.profile);
				setProfile(fetchedProfile);
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [api, basePath, profileId]);

	const { tree, total, frames } = useMemo(() => {
		if (!profile) return { tree: null, total: 0, frames: [] as RenderFrame[] };
		const { root, total } = aggregateFlameTree(profile, {
			traceIdFilter,
			valueIndex: 0,
		});
		return { tree: root, total, frames: flattenWithCoords(root) };
	}, [profile, traceIdFilter]);

	// Active root for rendering — start at the synthetic root, narrow
	// when the user zooms into a frame.
	const renderRoot = zoomedNode ?? tree;
	const renderFrames: RenderFrame[] = useMemo(() => {
		if (!renderRoot) return [];
		return flattenWithCoords(renderRoot);
	}, [renderRoot]);

	const palette = paletteFor(meta?.profileType ?? profileType);

	if (loading) {
		return (
			<div className="p-4 text-[0.875rem] opacity-60">Loading profile…</div>
		);
	}

	if (error) {
		return (
			<div className="p-4 text-[0.875rem] text-sys-error">
				Failed to load profile: {error}
			</div>
		);
	}

	if (!profile || !tree || frames.length === 0 || total === 0) {
		return (
			<div className="p-4 text-[0.875rem] opacity-60">
				—{" "}
				{traceIdFilter
					? `No samples in this profile match trace ${traceIdFilter.slice(0, 12)}…`
					: "Profile has no samples to render."}
			</div>
		);
	}

	const renderTotal = renderRoot ? renderRoot.value : 1;
	const maxDepth = renderFrames.reduce((m, f) => Math.max(m, f.depth), 0);
	const heightPx = (maxDepth + 1) * ROW_HEIGHT;

	return (
		<div className="flex flex-col gap-2 p-2">
			<div className="flex items-center gap-3 text-[0.75rem] font-mono">
				<span className="font-bold">{title ?? "Flame graph"}</span>
				{meta && (
					<>
						<span className="opacity-60">
							{meta.serviceName ?? "?"} · {meta.profileType}
						</span>
						<span className="opacity-60">{meta.durationMs}ms window</span>
						<span className="opacity-60">
							{(meta.blobSizeBytes / 1024).toFixed(1)} KB blob
						</span>
					</>
				)}
				{traceIdFilter && (
					<span className="bg-sys-bg px-1.5 py-0.5 text-[0.625rem] font-bold uppercase">
						trace {traceIdFilter.slice(0, 12)}…
					</span>
				)}
				{zoomedNode && (
					<button
						className="ml-auto underline cursor-pointer hover:text-sys-primary"
						onClick={() => setZoomedNode(null)}
					>
						🔥 Reset zoom
					</button>
				)}
			</div>

			<div className="relative">
				<svg
					width="100%"
					height={heightPx}
					viewBox={`0 0 100 ${heightPx}`}
					preserveAspectRatio="none"
					style={{
						backgroundColor: "var(--color-sys-surface)",
						border: "1px solid var(--color-sys-outline)",
						minHeight: heightPx,
					}}
				>
					{renderFrames.map((frame, i) => {
						if (frame.name === "__root__") return null;
						const widthPct = (frame.value / renderTotal) * 100;
						const xPct =
							((frame.offset - (renderRoot!.children.size > 0 ? 0 : 0)) /
								renderTotal) *
								100 -
							0;
						// Recompute x relative to the rendered root's children.
						// flattenWithCoords gives offsets relative to the synthetic
						// root we passed in (renderRoot) so xPct is correct.
						const realXPct = (frame.offset / renderTotal) * 100;
						if (widthPct < (MIN_FRAME_PX / 1000) * 100) return null;
						const color = palette[stableHash(frame.name) % palette.length];
						const isHover =
							hovered?.name === frame.name && hovered?.depth === frame.depth;
						return (
							<g key={`${frame.depth}-${frame.offset}-${i}`}>
								<rect
									x={`${realXPct}%`}
									y={frame.depth * ROW_HEIGHT}
									width={`${widthPct}%`}
									height={ROW_HEIGHT - 1}
									fill={color}
									stroke={isHover ? "var(--color-sys-on-surface)" : "white"}
									strokeWidth={isHover ? 1 : 0.3}
									style={{ cursor: "pointer" }}
									onMouseEnter={() => setHovered(frame)}
									onMouseLeave={() => setHovered(null)}
									onClick={() => setZoomedNode(frame)}
								>
									<title>
										{frame.name}
										{"\n"}
										{frame.value} samples (
										{((frame.value / total) * 100).toFixed(1)}% of total)
									</title>
								</rect>
								{widthPct > 4 && (
									<text
										x={`${realXPct}%`}
										y={frame.depth * ROW_HEIGHT + ROW_HEIGHT / 2 + 3}
										fontSize={9}
										fontFamily="var(--font-mono, monospace)"
										fill="white"
										style={{ pointerEvents: "none" }}
										dx={2}
									>
										{frame.name.length > 60
											? frame.name.slice(0, 57) + "…"
											: frame.name}
									</text>
								)}
							</g>
						);
					})}
				</svg>
			</div>

			{hovered && hovered.name !== "__root__" && (
				<div className="font-mono text-[0.75rem] bg-sys-surface-low px-2 py-1 border border-sys-outline">
					<span className="font-bold">{hovered.name}</span>
					<span className="ml-2 opacity-60">
						{hovered.value.toLocaleString()} samples ·{" "}
						{((hovered.value / total) * 100).toFixed(1)}% of total · depth{" "}
						{hovered.depth}
					</span>
					<span className="ml-3 opacity-50">click to zoom</span>
				</div>
			)}

			<div className="text-[0.625rem] font-mono opacity-50">
				{frames.length - 1} frames · {total.toLocaleString()} total samples ·
				palette: {meta?.profileType ?? profileType ?? "neutral"}
			</div>
		</div>
	);
}
