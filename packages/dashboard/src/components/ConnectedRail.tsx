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
// the dashboard package doesn't import from @obs/collector at runtime.
export type ConnectedEntityKind =
	| "span"
	| "log"
	| "usage"
	| "ai_call"
	| "replay"
	| "alert"
	| "analysis"
	| "user";

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

const SectionHeader = ({ children }: { children: React.ReactNode }) => (
	<div className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-70 mt-3 mb-1">
		{children}
	</div>
);

const SectionGroup = ({
	section,
	onNavigate,
}: {
	section: ConnectedSection;
	onNavigate?: (href: string) => void;
}) => {
	if (section.links.length === 0) {
		return (
			<div className="px-1 py-1">
				<div className="text-[0.875rem] font-semibold opacity-90">
					{section.label}
				</div>
				<div
					className="text-[0.75rem] opacity-60 italic mt-1"
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
			<aside className="w-[260px] flex-none bg-sys-surface border-[1px] border-sys-outline p-2">
				<div className="text-[0.75rem] opacity-60">Loading neighbors...</div>
			</aside>
		);
	}

	if (error || !manifest) {
		return (
			<aside className="w-[260px] flex-none bg-sys-surface border-[1px] border-sys-outline p-2">
				<div className="text-[0.75rem] text-sys-error" title={error ?? ""}>
					Failed to load related entities
				</div>
			</aside>
		);
	}

	const renderGroup = (sections: ConnectedSection[]) =>
		sections.map((s, i) => (
			<SectionGroup
				key={`${s.label}-${i}`}
				section={s}
				onNavigate={onNavigate}
			/>
		));

	return (
		<aside className="w-[260px] flex-none bg-sys-surface border-[1px] border-sys-outline p-2 overflow-y-auto">
			<div className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-50 mb-2">
				Connected — {entityKind}
			</div>
			<SectionHeader>Up</SectionHeader>
			{renderGroup(manifest.up)}
			<SectionHeader>Across</SectionHeader>
			{renderGroup(manifest.across)}
			<SectionHeader>Down</SectionHeader>
			{renderGroup(manifest.down)}
			<SectionHeader>Related</SectionHeader>
			{renderGroup(manifest.related)}
		</aside>
	);
}
