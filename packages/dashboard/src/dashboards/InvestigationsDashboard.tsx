import type {
	AnalysisDefinition,
	AnalysesListResponse,
} from "@obs/types";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../components/states";
import { SectionTitle } from "../components/primitives";
import { useApi } from "../use-api";

/**
 * RFC 0002 Stage 4 — Investigations index.
 *
 * Lists every Analysis with `view: "page"`. Click a row → /#/investigate/:id.
 * Stage 4 ships three universal templates (error_top_offenders,
 * latency_outlier_attribution, log_anomaly_summary). Tier 2 user-defined
 * page analyses will appear here automatically.
 */
export function InvestigationsDashboard({
	onNavigate,
}: {
	onNavigate: (route: {
		tab?: string;
		investigationId?: string;
	}) => void;
}) {
	const api = useApi();
	const [definitions, setDefinitions] = useState<AnalysisDefinition[] | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const res = await api<AnalysesListResponse>("/analyses");
			setDefinitions(
				res.analyses.filter((d) => d.view === "page"),
			);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, [api]);

	useEffect(() => {
		load();
	}, [load]);

	if (error) {
		return (
			<div className="p-3">
				<div className="bg-sys-error/10 border-l-[4px] border-sys-error p-3">
					<p className="text-[0.8125rem] font-medium text-sys-error m-0">
						{error}
					</p>
				</div>
			</div>
		);
	}

	if (definitions === null) {
		return (
			<div className="p-3 text-[0.8125rem] text-sys-on-surface-muted">
				Loading…
			</div>
		);
	}

	if (definitions.length === 0) {
		return (
			<div className="bg-sys-surface border-[1px] border-sys-outline m-2">
				<EmptyState
					title="No investigations yet"
					description={
						<>
							Send some telemetry. Stage 4 ships three universal
							investigations that derive from your traces and logs.
						</>
					}
				/>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-y-auto">
			<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
				<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
					Investigations
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] text-sys-on-surface-muted">
					{definitions.length}{" "}
					{definitions.length === 1 ? "template" : "templates"}
				</span>
			</div>
			<SectionTitle title="Templates" />
			<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
				{definitions.map((def) => (
					<a
						key={def.id}
						href={`#/investigate/${encodeURIComponent(def.id)}`}
						onClick={(e) => {
							// Let cmd+click / middle-click open in a new tab.
							if (e.metaKey || e.ctrlKey || e.button !== 0) return;
							e.preventDefault();
							onNavigate({
								tab: "investigate",
								investigationId: def.id,
							});
						}}
						className="flex flex-col bg-sys-surface border border-sys-outline-soft hover:bg-sys-surface-low cursor-pointer no-underline text-inherit p-3"
						data-test-investigation-link={def.id}
					>
						<span className="text-[0.875rem] font-semibold leading-snug">
							{def.title}
						</span>
						<span className="text-[0.6875rem] text-sys-on-surface-muted mt-1 font-mono">
							{def.id}
						</span>
					</a>
				))}
			</div>
		</div>
	);
}

export default InvestigationsDashboard;
