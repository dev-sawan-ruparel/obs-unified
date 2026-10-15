import type { ChangeEvent, ChangeEventKind } from "@obsunified/types";
import { useEffect, useState } from "react";
import { useDashboard } from "../provider";
import {
	normalizeConnectedHref,
	RelationshipCertaintyBadge,
} from "./ConnectedRail";

export const CHANGE_KIND_LABELS: Record<ChangeEventKind, string> = {
	deploy: "deploy",
	rollback: "rollback",
	config_change: "config_change",
	feature_flag: "feature_flag",
	prompt_rollout: "prompt_rollout",
	agent_version: "agent_version",
	schema_migration: "schema_migration",
	infra_scale: "infra_scale",
};

const changeKindStyle = (kind: ChangeEventKind): string => {
	switch (kind) {
		case "rollback":
			return "bg-sys-error/15 text-sys-error border-sys-error/30";
		case "feature_flag":
			return "bg-amber-500/15 text-amber-700 border-amber-500/30";
		case "config_change":
			return "bg-sys-accent/15 text-sys-accent border-sys-accent/30";
		default:
			return "bg-sys-primary/15 text-sys-primary border-sys-primary/30";
	}
};

export function formatChangeVersionLabel(
	change: Pick<
		ChangeEvent,
		"previousVersion" | "version" | "previousCommitSha" | "commitSha"
	>,
): string | null {
	if (
		change.previousVersion &&
		change.version &&
		change.previousVersion !== change.version
	) {
		return `${change.previousVersion} → ${change.version}`;
	}
	if (change.version) {
		return change.version;
	}
	if (
		change.previousCommitSha &&
		change.commitSha &&
		change.previousCommitSha !== change.commitSha
	) {
		return `${change.previousCommitSha.slice(0, 7)} → ${change.commitSha.slice(0, 7)}`;
	}
	if (change.commitSha) {
		return change.commitSha.slice(0, 7);
	}
	return null;
}

export interface ChangeMarkersBarProps {
	changes?: ChangeEvent[];
	environment?: string;
	onNavigate?: (href: string) => void;
	onSelectChange?: (change: ChangeEvent) => void;
}

function ChangeMarkersBarContent({
	changes,
	onNavigate,
	onSelectChange,
}: {
	changes: ChangeEvent[];
	onNavigate?: (href: string) => void;
	onSelectChange?: (change: ChangeEvent) => void;
}) {
	if (changes.length === 0) {
		return null;
	}

	return (
		<div
			data-change-markers-bar
			className="mb-2 flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2 border border-sys-outline-soft text-[0.75rem]"
		>
			<span className="text-[0.625rem] font-bold uppercase tracking-[0.08em] text-sys-on-surface-muted flex-none">
				Recent Changes ({changes.length})
			</span>
			<div className="flex flex-wrap items-center gap-1.5 min-w-0">
				{changes.map((chg) => {
					const versionLabel = formatChangeVersionLabel(chg);
					const href = `#/changes/${encodeURIComponent(chg.id)}`;
					return (
						<a
							key={chg.id}
							href={href}
							data-change-id={chg.id}
							data-change-kind={chg.kind}
							onClick={(e) => {
								if (onSelectChange) {
									e.preventDefault();
									onSelectChange(chg);
									return;
								}
								if (onNavigate) {
									e.preventDefault();
									onNavigate(normalizeConnectedHref(href));
								}
							}}
							className="inline-flex items-center gap-1.5 px-2 py-1 border border-sys-outline bg-sys-surface-low hover:bg-sys-surface-high font-mono text-[0.6875rem] text-sys-on-surface no-underline transition-none"
							title={`${chg.summary} (${chg.id})`}
						>
							<span
								className={`px-1 py-0 text-[0.5625rem] font-bold uppercase rounded-sm border ${changeKindStyle(
									chg.kind,
								)}`}
							>
								{CHANGE_KIND_LABELS[chg.kind] ?? chg.kind}
							</span>
							<span className="px-1 py-0 text-[0.5625rem] font-bold uppercase rounded-sm border bg-sys-surface border-sys-outline text-sys-on-surface-muted">
								{chg.environment}
							</span>
							{versionLabel && (
								<span
									data-change-version
									className="font-bold text-sys-primary"
								>
									{versionLabel}
								</span>
							)}
							<span className="truncate max-w-[220px]">{chg.summary}</span>
							{chg.relationshipCertainty && (
								<RelationshipCertaintyBadge
									certainty={chg.relationshipCertainty}
								/>
							)}
						</a>
					);
				})}
			</div>
		</div>
	);
}

function AutoFetchedChangeMarkersBar({
	environment,
	onNavigate,
	onSelectChange,
}: Omit<ChangeMarkersBarProps, "changes">) {
	const { basePath, fetcher } = useDashboard();
	const [changes, setChanges] = useState<ChangeEvent[]>([]);

	useEffect(() => {
		let active = true;
		const params = new URLSearchParams();
		if (environment) params.set("environment", environment);
		params.set("limit", "10");
		const qs = params.toString();
		const url = `${basePath.replace(/\/$/, "")}/changes${qs ? `?${qs}` : ""}`;
		fetcher(url, { credentials: "include" })
			.then(async (res) => {
				if (!res.ok) return [];
				const body = (await res.json().catch(() => null)) as
					| { changes?: ChangeEvent[]; rows?: ChangeEvent[] }
					| ChangeEvent[]
					| null;
				if (Array.isArray(body)) return body;
				if (body && Array.isArray(body.changes)) return body.changes;
				if (body && Array.isArray(body.rows)) return body.rows;
				return [];
			})
			.then((list) => {
				if (active) setChanges(list);
			})
			.catch(() => {
				if (active) setChanges([]);
			});
		return () => {
			active = false;
		};
	}, [basePath, fetcher, environment]);

	return (
		<ChangeMarkersBarContent
			changes={changes}
			onNavigate={onNavigate}
			onSelectChange={onSelectChange}
		/>
	);
}

export function ChangeMarkersBar(props: ChangeMarkersBarProps) {
	if (props.changes !== undefined) {
		return (
			<ChangeMarkersBarContent
				changes={props.changes}
				onNavigate={props.onNavigate}
				onSelectChange={props.onSelectChange}
			/>
		);
	}
	return <AutoFetchedChangeMarkersBar {...props} />;
}
