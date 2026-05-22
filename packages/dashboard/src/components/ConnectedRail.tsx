/**
 * RFC 0006 Phase 3.2-3.4 — Connected rail component.
 *
 * Drops into every detail surface (TelemetryDashboard span drawer,
 * LogsDashboard log drawer, etc.) and renders the four-section
 * navigation graph for the entity in scope. Reads from the manifest
 * endpoint shipped in Phase 3.1.
 *
 * Behavioral contracts (per RFC 0006):
 *   - Informative absence: empty sections render with their reason.
 *     Never silently hide a section header.
 *   - Count-link: sections with > 5 neighbors collapse to a single link
 *     showing the count + a sample line. The user clicks through to a
 *     filtered list view rather than scrolling 200 inline items.
 */

import { useEffect, useState } from "react";
import { useApi } from "../use-api";

// Mirror of the collector's connected-routes types. Kept structural so
// the dashboard package doesn't import from @obs-unified/collector at runtime.
export type ConnectedEntityKind =
	| "span"
	| "log"
	| "usage"
	| "ai_call"
	| "replay"
	| "alert"
	| "analysis"
	| "user"
	| "action"
	| "agent_run"
	| "tool_call";

interface ConnectedLink {
	label: string;
	href: string;
	count?: number;
	sample?: string;
}

interface ConnectedSection {
	label: string;
	links: ConnectedLink[];
	emptyReason?: string;
}

interface ConnectedManifest {
	entity: { kind: ConnectedEntityKind; id: string; projectId: string };
	up: ConnectedSection[];
	across: ConnectedSection[];
	down: ConnectedSection[];
	related: ConnectedSection[];
}

export interface ConnectedRailProps {
	entityKind: ConnectedEntityKind;
	entityId: string;
	/**
	 * Hints the manifest endpoint uses to resolve neighbors that aren't
	 * derivable from the entity id alone — e.g. logs need to know which
	 * trace they belong to before the rail can show the parent trace.
	 */
	traceId?: string;
	sessionId?: string;
	onNavigate?: (href: string) => void;
}

// Title-case the four canonical section names so the group label can be
// compared against its parent section header. When the only group inside
// a section is a placeholder labeled identically to its section ("Up" /
// "Down" / "Related"), we skip the inner label to avoid the visual
// "UP / Up — emptyReason" duplication.
const SECTION_NAMES = new Set(["Up", "Across", "Down", "Related"]);

const SectionHeader = ({ children }: { children: React.ReactNode }) => (
	<div className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mt-3 mb-1">
		{children}
	</div>
);

const SectionGroup = ({
	section,
	suppressLabel,
	onNavigate,
}: {
	section: ConnectedSection;
	suppressLabel?: boolean;
	onNavigate?: (href: string) => void;
}) => {
	if (section.links.length === 0) {
		return (
			<div className="px-1 py-1">
				{!suppressLabel && (
					<div className="text-[0.875rem] font-semibold opacity-90">
						{section.label}
					</div>
				)}
				<div
					className={`text-[0.75rem] opacity-60 italic ${suppressLabel ? "" : "mt-1"}`}
					title={section.emptyReason}
				>
					— {section.emptyReason ?? "No neighbors."}
				</div>
			</div>
		);
	}
	return (
		<div className="px-1 py-1">
			<div className="text-[0.875rem] font-semibold opacity-90 mb-1">
				{section.label}
			</div>
			<div className="flex flex-col gap-1">
				{section.links.map((link, i) => (
					<button
						key={`${link.href}-${i}`}
						onClick={() => onNavigate?.(link.href)}
						className="text-left text-[0.75rem] font-mono px-2 py-1 border-[1px] border-sys-outline hover:bg-sys-surface-high cursor-pointer transition-none truncate"
						title={link.sample ?? link.label}
					>
						{link.count !== undefined && (
							<span className="font-bold mr-1.5">{link.count}×</span>
						)}
						{link.label}
					</button>
				))}
			</div>
		</div>
	);
};

// Strip the inner group label when it's a redundant duplicate of the
// outer section header. RFC 0006's "informative absence" requirement is
// for SECTIONS, not for individual groups — when a section contains
// nothing but a placeholder whose label matches the section name (UP →
// "Up — User is the root identity"), the doubled label adds noise
// without conveying anything. Populated groups keep their labels.
const shouldSuppressGroupLabel = (
	section: ConnectedSection,
	parentHeader: string,
): boolean =>
	section.links.length === 0 &&
	(section.label === parentHeader ||
		section.label.toLowerCase() === parentHeader.toLowerCase()) &&
	SECTION_NAMES.has(parentHeader);

// De-dupe near-identical adjacent groups: when "Latest session" and
// "Recent sessions" both render the same single session link, only show
// the first. Pattern emerges on users with one session in the window;
// keeping both is visual noise that suggests two distinct things exist.
const dedupeAdjacent = (sections: ConnectedSection[]): ConnectedSection[] => {
	const out: ConnectedSection[] = [];
	for (const section of sections) {
		const prev = out[out.length - 1];
		if (
			prev &&
			prev.links.length === 1 &&
			section.links.length === 1 &&
			prev.links[0].href === section.links[0].href
		) {
			continue;
		}
		out.push(section);
	}
	return out;
};

export function ConnectedRail({
	entityKind,
	entityId,
	traceId,
	sessionId,
	onNavigate,
}: ConnectedRailProps) {
	const api = useApi();
	const [manifest, setManifest] = useState<ConnectedManifest | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setLoading(true);
		setError(null);
		const params = new URLSearchParams();
		if (traceId) params.set("trace_id", traceId);
		if (sessionId) params.set("session_id", sessionId);
		const qs = params.toString();
		const path = `/connected/${entityKind}/${encodeURIComponent(entityId)}${qs ? `?${qs}` : ""}`;
		api<ConnectedManifest>(path)
			.then((data) => setManifest(data))
			.catch((err) =>
				setError(err instanceof Error ? err.message : String(err)),
			)
			.finally(() => setLoading(false));
	}, [api, entityKind, entityId, traceId, sessionId]);

	if (loading) {
		return (
			<aside className="w-[260px] min-w-[260px] flex-none bg-sys-surface border-[1px] border-sys-outline p-2">
				<div className="text-[0.75rem] opacity-60">Loading neighbors...</div>
			</aside>
		);
	}

	if (error || !manifest) {
		return (
			<aside className="w-[260px] min-w-[260px] flex-none bg-sys-surface border-[1px] border-sys-outline p-2">
				<div className="text-[0.75rem] text-sys-error" title={error ?? ""}>
					Failed to load related entities
				</div>
			</aside>
		);
	}

	const renderGroup = (sections: ConnectedSection[], parentHeader: string) => {
		const deduped = dedupeAdjacent(sections);
		return deduped.map((s, i) => (
			<SectionGroup
				key={`${s.label}-${i}`}
				section={s}
				suppressLabel={shouldSuppressGroupLabel(s, parentHeader)}
				onNavigate={onNavigate}
			/>
		));
	};

	// min-w-[260px] guards against the layout bug where a flex parent
	// squeezes the rail down to ~10px and monospace content character-wraps
	// vertically. The aside is meant to be a fixed-width sidebar — not a
	// resizable column. overflow-y-auto lets the inner content scroll
	// independently rather than being chopped by overflow:hidden parents.
	return (
		<aside className="w-[260px] min-w-[260px] flex-none bg-sys-surface border-[1px] border-sys-outline p-2 overflow-y-auto">
			<div className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-50 mb-2">
				Connected — {entityKind}
			</div>
			<SectionHeader>Up</SectionHeader>
			{renderGroup(manifest.up, "Up")}
			<SectionHeader>Across</SectionHeader>
			{renderGroup(manifest.across, "Across")}
			<SectionHeader>Down</SectionHeader>
			{renderGroup(manifest.down, "Down")}
			<SectionHeader>Related</SectionHeader>
			{renderGroup(manifest.related, "Related")}
		</aside>
	);
}
