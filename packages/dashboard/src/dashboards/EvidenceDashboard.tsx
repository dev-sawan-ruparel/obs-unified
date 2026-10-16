import {
	dashboardRouteToHref,
	type EvidenceBundle,
	type EvidenceNextPivot,
	type EvidenceReference,
	type EvidenceRetrievalRef,
} from "@obsunified/types";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button";
import {
	type ConnectedEntityKind,
	ConnectedRail,
	normalizeConnectedHref,
} from "../components/ConnectedRail";
import {
	Card,
	SectionTitle,
	Stat,
	UpdatedChip,
} from "../components/primitives";
import { EmptyState, StateRow } from "../components/states";
import { useApi } from "../use-api";

export type AnchorKind =
	| "trace"
	| "action"
	| "agent_run"
	| "tool_call"
	| "change"
	| "finding"
	| "incident"
	| (string & {});

export interface EvidenceDashboardProps {
	initialAnchorKind?: AnchorKind;
	initialAnchorId?: string;
	/** Hash/href navigation for pivots and the connected rail. */
	onNavigate?: (href: string) => void;
}

/**
 * Evidence anchors that are also connected-graph entities. A `trace` anchor
 * has no rail entity of its own (the rail keys on spans), so it is omitted.
 */
export function connectedKindForAnchor(
	kind: AnchorKind,
): ConnectedEntityKind | null {
	switch (kind) {
		case "action":
			return "action";
		case "agent_run":
			return "agent_run";
		case "tool_call":
			return "tool_call";
		case "change":
			return "change";
		case "finding":
			return "finding";
		case "incident":
			return "incident";
		default:
			return null;
	}
}

const navigateHref = (href: string, onNavigate?: (href: string) => void) => {
	const normalized = normalizeConnectedHref(href);
	if (onNavigate) {
		onNavigate(normalized);
		return;
	}
	if (typeof location !== "undefined") {
		if (normalized.startsWith("#")) location.hash = normalized.slice(1);
		else location.href = normalized;
	}
};

function PivotButton({
	pivot,
	onNavigate,
}: {
	pivot: EvidenceNextPivot;
	onNavigate?: (href: string) => void;
}) {
	return (
		<button
			type="button"
			data-pivot-route={pivot.route}
			onClick={() => navigateHref(pivot.route, onNavigate)}
			className="border border-sys-outline-soft bg-sys-surface px-2 py-1 text-left text-[0.75rem] hover:bg-sys-surface-high cursor-pointer"
			title={pivot.reason}
		>
			<span className="font-semibold">{pivot.label}</span>
			<span className="ml-2 font-mono text-sys-on-surface-muted">
				{pivot.entityKind}:{compactId(pivot.entityId)}
			</span>
		</button>
	);
}

function EvidenceReferenceRow({
	reference,
	onNavigate,
}: {
	reference: EvidenceReference;
	onNavigate?: (href: string) => void;
}) {
	return (
		<div
			data-evidence-reference={reference.evidenceId}
			className="border border-sys-outline-soft bg-sys-surface p-2 text-[0.75rem]"
		>
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onClick={() => navigateHref(reference.route, onNavigate)}
					className="font-mono font-semibold underline cursor-pointer"
				>
					{reference.entityKind}:{compactId(reference.entityId)}
				</button>
				<span className="text-sys-on-surface-muted">{reference.source}</span>
				{reference.relationshipCertainty && (
					<span className="font-mono uppercase text-[0.625rem]">
						{reference.relationshipCertainty}
					</span>
				)}
				{reference.causalProofTier && (
					<span className="font-mono uppercase text-[0.625rem]">
						{reference.causalProofTier}
					</span>
				)}
				<span className="ml-auto font-mono text-sys-on-surface-muted">
					conf {reference.confidence.toFixed(2)}
				</span>
			</div>
			<div className="mt-1 leading-5 text-sys-on-surface-muted">
				{reference.reason}
			</div>
		</div>
	);
}

/**
 * Entity bundles (change, finding, incident, ...) carry their substance in
 * `evidenceReferences`, `suggestedNextPivots` and `autosre`, not in retrieval
 * refs, so those are rendered here together with the connected rail.
 */
export function EvidenceBundleDetails({
	bundle,
	onNavigate,
}: {
	bundle: EvidenceBundle;
	onNavigate?: (href: string) => void;
}) {
	const autosre = bundle.autosre;
	const railKind = bundle.anchor
		? connectedKindForAnchor(bundle.anchor.entityKind as AnchorKind)
		: null;
	return (
		<div className="space-y-3" data-evidence-details>
			{autosre?.faultLocus && (
				<div
					data-fault-locus
					className="border border-sys-outline-soft bg-sys-surface-low p-3 text-[0.75rem]"
				>
					<SectionTitle title="Fault Locus" />
					<div className="mt-1 flex flex-wrap items-center gap-3 font-mono">
						<span>{autosre.faultLocus.nodeId}</span>
						{autosre.faultLocus.spanId && (
							<span>span {compactId(autosre.faultLocus.spanId)}</span>
						)}
						<span className="uppercase">
							{autosre.faultLocus.relationshipCertainty}
						</span>
						{autosre.faultLocus.isBlackoutSuspected && (
							<span className="text-sys-warning">blackout suspected</span>
						)}
					</div>
				</div>
			)}

			{autosre && autosre.candidateChanges.length > 0 && (
				<div data-candidate-changes>
					<SectionTitle title="Candidate Changes" />
					<div className="mt-2 overflow-x-auto">
						<table className="w-full text-left text-[0.75rem]">
							<thead className="text-sys-on-surface-subtle">
								<tr>
									<th className="px-2 py-1">Change</th>
									<th className="px-2 py-1">Kind</th>
									<th className="px-2 py-1">Version</th>
									<th className="px-2 py-1">Cohort verdict</th>
									<th className="px-2 py-1">Proof tier</th>
									<th className="px-2 py-1 text-right">Error rate new/old</th>
								</tr>
							</thead>
							<tbody>
								{autosre.candidateChanges.map((change) => (
									<tr
										key={change.changeId}
										className="border-t border-sys-outline-soft"
									>
										<td className="px-2 py-1 font-mono">
											<button
												type="button"
												onClick={() =>
													navigateHref(
														dashboardRouteToHref({
															tab: "evidence",
															evidenceKind: "change",
															evidenceId: change.changeId,
														}),
														onNavigate,
													)
												}
												className="underline cursor-pointer"
											>
												{compactId(change.changeId)}
											</button>
										</td>
										<td className="px-2 py-1">{change.kind}</td>
										<td className="px-2 py-1 font-mono">
											{change.previousVersion ?? "?"} → {change.version ?? "?"}
										</td>
										<td className="px-2 py-1">{change.cohortVerdict}</td>
										<td className="px-2 py-1">{change.causalProofTier}</td>
										<td className="px-2 py-1 text-right font-mono">
											{change.rateNew ?? "–"} / {change.rateOld ?? "–"} (
											{change.sampleNew}/{change.sampleOld})
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{autosre && autosre.contentionCandidates.length > 0 && (
				<div data-contention-candidates>
					<SectionTitle title="Contention Candidates" />
					<ul className="mt-2 space-y-1 text-[0.75rem]">
						{autosre.contentionCandidates.map((c) => (
							<li
								key={`${c.aggressorTraceId}:${c.aggressorSpanId}`}
								className="border border-sys-outline-soft bg-sys-surface px-2 py-1 font-mono"
							>
								{c.aggressorServiceName ?? "unknown"} · trace{" "}
								{compactId(c.aggressorTraceId)} · {c.sharedTargetNodeId} ·{" "}
								{Math.round(c.totalResourceTimeMs)}ms ·{" "}
								{c.relationshipCertainty}
							</li>
						))}
					</ul>
				</div>
			)}

			{autosre && autosre.priorFindings.length > 0 && (
				<div data-prior-findings>
					<SectionTitle title="Prior Findings" />
					<ul className="mt-2 space-y-1 text-[0.75rem]">
						{autosre.priorFindings.map((f) => (
							<li
								key={f.findingId}
								className="border border-sys-outline-soft bg-sys-surface px-2 py-1"
							>
								<button
									type="button"
									onClick={() =>
										navigateHref(
											dashboardRouteToHref({
												tab: "evidence",
												evidenceKind: "finding",
												evidenceId: f.findingId,
											}),
											onNavigate,
										)
									}
									className="font-semibold underline cursor-pointer"
								>
									{f.title}
								</button>
								<span className="ml-2 font-mono text-sys-on-surface-muted">
									{f.causalProofTier} · {f.causalVerificationStatus} ·{" "}
									{f.recoveryStatus}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{bundle.evidenceReferences.length > 0 && (
				<div data-evidence-references>
					<SectionTitle title="Evidence References" />
					<div className="mt-2 space-y-2">
						{bundle.evidenceReferences.map((reference) => (
							<EvidenceReferenceRow
								key={reference.evidenceId}
								reference={reference}
								onNavigate={onNavigate}
							/>
						))}
					</div>
				</div>
			)}

			{bundle.suggestedNextPivots.length > 0 && (
				<div data-next-pivots>
					<SectionTitle title="Suggested Next Pivots" />
					<div className="mt-2 flex flex-wrap gap-2">
						{bundle.suggestedNextPivots.map((pivot) => (
							<PivotButton
								key={`${pivot.entityKind}:${pivot.entityId}:${pivot.route}`}
								pivot={pivot}
								onNavigate={onNavigate}
							/>
						))}
					</div>
				</div>
			)}

			{bundle.anchor && railKind && (
				<ConnectedRail
					entityKind={railKind}
					entityId={bundle.anchor.entityId}
					onNavigate={onNavigate}
				/>
			)}
		</div>
	);
}

interface EvidenceStats {
	projectId: string;
	generatedAt: string;
	warning?: string;
	byKind: Array<{ kind: string; issuedCount: number; expansionCount: number }>;
	bySource: Array<{
		source: string;
		kind: string;
		issuedCount: number;
		expansionCount: number;
	}>;
	recentRefs: Array<{
		refId: string;
		kind: string;
		anchor: { entityKind: string; entityId: string };
		source: string;
		issuedAt: string;
		lastSeenAt: string;
	}>;
	recentExpansions: Array<{
		id: string;
		refId: string;
		kind: string;
		source: string | null;
		operation: string;
		resultStatus: string;
		limit: number | null;
		query: string | null;
		expandedAt: string;
	}>;
}

interface RefExpansion {
	refId: string;
	kind: string;
	data?: unknown;
	query?: string;
}

const compactId = (value: string) =>
	value.length > 28 ? `${value.slice(0, 12)}…${value.slice(-10)}` : value;

function expansionsPerRef(expanded: number, issued: number) {
	if (issued === 0) return "0.0x";
	return `${(expanded / issued).toFixed(1)}x`;
}

function JsonPreview({ value }: { value: unknown }) {
	return (
		<pre className="max-h-72 overflow-auto bg-sys-surface-low p-2 text-[0.6875rem] leading-5 text-sys-on-surface-muted">
			{JSON.stringify(value, null, 2)}
		</pre>
	);
}

export function EvidenceDashboard({
	initialAnchorKind,
	initialAnchorId,
	onNavigate,
}: EvidenceDashboardProps = {}) {
	const api = useApi();
	const [stats, setStats] = useState<EvidenceStats | null>(null);
	const [statsError, setStatsError] = useState<string | null>(null);
	const [loadingStats, setLoadingStats] = useState(true);
	const [anchorKind, setAnchorKind] = useState<AnchorKind>(
		initialAnchorKind ?? "trace",
	);
	const [anchorId, setAnchorId] = useState(initialAnchorId ?? "");
	const [bundle, setBundle] = useState<EvidenceBundle | null>(null);
	const [bundleError, setBundleError] = useState<string | null>(null);
	const [loadingBundle, setLoadingBundle] = useState(false);
	const [expanded, setExpanded] = useState<Record<string, RefExpansion>>({});

	useEffect(() => {
		let active = true;
		async function loadStats() {
			try {
				const next = await api<EvidenceStats>("/evidence/stats");
				if (active) {
					setStats(next);
					setStatsError(null);
				}
			} catch (err) {
				if (active) {
					setStats(null);
					setStatsError(err instanceof Error ? err.message : String(err));
				}
			} finally {
				if (active) setLoadingStats(false);
			}
		}
		loadStats();
		return () => {
			active = false;
		};
	}, [api]);

	useEffect(() => {
		if (initialAnchorKind) setAnchorKind(initialAnchorKind);
		if (initialAnchorId !== undefined) setAnchorId(initialAnchorId);
		if (!initialAnchorId?.trim()) return;
		const kindToLoad = initialAnchorKind ?? "trace";
		const idToLoad = initialAnchorId.trim();
		let active = true;
		setLoadingBundle(true);
		setBundleError(null);
		setExpanded({});
		api<EvidenceBundle>("/evidence/bundle", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				anchor: { entityKind: kindToLoad, entityId: idToLoad },
			}),
		})
			.then((next) => {
				if (active) setBundle(next);
			})
			.catch((err) => {
				if (active) {
					setBundle(null);
					setBundleError(err instanceof Error ? err.message : String(err));
				}
			})
			.finally(() => {
				if (active) setLoadingBundle(false);
			});
		return () => {
			active = false;
		};
	}, [api, initialAnchorKind, initialAnchorId]);

	const totals = useMemo(() => {
		const issued =
			stats?.byKind.reduce((sum, row) => sum + row.issuedCount, 0) ?? 0;
		const expansions =
			stats?.byKind.reduce((sum, row) => sum + row.expansionCount, 0) ?? 0;
		return { issued, expansions };
	}, [stats]);

	const loadBundle = async () => {
		if (!anchorId.trim()) return;
		setLoadingBundle(true);
		setBundleError(null);
		setExpanded({});
		try {
			const next = await api<EvidenceBundle>("/evidence/bundle", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					anchor: { entityKind: anchorKind, entityId: anchorId.trim() },
				}),
			});
			setBundle(next);
		} catch (err) {
			setBundle(null);
			setBundleError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoadingBundle(false);
		}
	};

	const expandRef = async (ref: EvidenceRetrievalRef) => {
		const next = await api<RefExpansion>(
			`/evidence/refs/${encodeURIComponent(ref.refId)}`,
		);
		setExpanded((prev) => ({ ...prev, [ref.refId]: next }));
	};

	return (
		<div className="flex h-full flex-col overflow-y-auto bg-sys-bg p-2 font-sans text-sys-on-surface">
			<div className="mb-2 flex flex-none items-center gap-4 border border-sys-outline bg-sys-surface px-4 py-2">
				<span className="text-[0.8125rem] font-semibold">
					Evidence Retrieval
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] text-sys-on-surface-muted">
					{totals.issued.toLocaleString()} refs issued
				</span>
				<div className="ml-auto">
					{stats?.generatedAt && <UpdatedChip at={stats.generatedAt} />}
				</div>
			</div>

			<div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4">
				<Stat label="Refs Issued" value={totals.issued.toLocaleString()} />
				<Stat
					label="Expansions"
					value={totals.expansions.toLocaleString()}
					accent="primary"
				/>
				<Stat
					label="Expansions / Ref"
					value={expansionsPerRef(totals.expansions, totals.issued)}
				/>
				<Stat
					label="Kinds"
					value={(stats?.byKind.length ?? 0).toLocaleString()}
				/>
			</div>

			<div className="mb-2 grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_420px]">
				<Card className="border border-sys-outline p-3">
					<SectionTitle title="Bundle Explorer" />
					<div
						data-anchor-kind={anchorKind}
						data-anchor-id={anchorId}
						className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[180px_minmax(0,1fr)_120px]"
					>
						<select
							value={anchorKind}
							onChange={(event) =>
								setAnchorKind(event.target.value as AnchorKind)
							}
							className="h-9 border border-sys-outline bg-sys-surface px-2 text-[0.8125rem]"
						>
							<option value="trace">trace</option>
							<option value="action">action</option>
							<option value="agent_run">agent_run</option>
							<option value="tool_call">tool_call</option>
							<option value="change">change</option>
							<option value="finding">finding</option>
							<option value="incident">incident</option>
							{![
								"trace",
								"action",
								"agent_run",
								"tool_call",
								"change",
								"finding",
								"incident",
							].includes(anchorKind) && (
								<option value={anchorKind}>{anchorKind}</option>
							)}
						</select>
						<input
							value={anchorId}
							onChange={(event) => setAnchorId(event.target.value)}
							placeholder="anchor id"
							className="h-9 border border-sys-outline bg-sys-surface px-2 font-mono text-[0.8125rem]"
						/>
						<Button
							onClick={loadBundle}
							disabled={!anchorId.trim() || loadingBundle}
						>
							{loadingBundle ? "Loading" : "Load"}
						</Button>
					</div>

					{bundleError && (
						<div className="mt-3 border border-sys-danger bg-sys-danger-container px-3 py-2 text-[0.8125rem] text-sys-on-danger-container">
							{bundleError}
						</div>
					)}

					{bundle ? (
						<div className="mt-3 space-y-3">
							<div className="border border-sys-outline-soft bg-sys-surface-low p-3">
								<div className="text-[0.75rem] font-semibold uppercase text-sys-on-surface-subtle">
									Summary
								</div>
								<p className="mt-1 text-[0.8125rem] leading-5">
									{bundle.summary}
								</p>
							</div>
							<div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
								{bundle.findings.map((finding) => (
									<div
										key={`${finding.title}:${finding.reason}`}
										className="border border-sys-outline-soft bg-sys-surface p-3"
									>
										<div className="text-[0.8125rem] font-semibold">
											{finding.title}
										</div>
										<div className="mt-1 text-[0.75rem] leading-5 text-sys-on-surface-muted">
											{finding.reason}
										</div>
									</div>
								))}
							</div>
							<EvidenceBundleDetails bundle={bundle} onNavigate={onNavigate} />
							<div>
								<SectionTitle title="Retrieval Refs" />
								<div className="mt-2 overflow-x-auto">
									<table className="w-full text-left text-[0.75rem]">
										<thead className="text-sys-on-surface-subtle">
											<tr>
												<th className="px-2 py-1">Kind</th>
												<th className="px-2 py-1">Source</th>
												<th className="px-2 py-1">Ref</th>
												<th className="px-2 py-1 text-right">Action</th>
											</tr>
										</thead>
										<tbody>
											{bundle.retrievalRefs.map((ref) => (
												<tr
													key={ref.refId}
													className="border-t border-sys-outline-soft"
												>
													<td className="px-2 py-1 font-mono">{ref.kind}</td>
													<td className="px-2 py-1">{ref.source}</td>
													<td className="px-2 py-1 font-mono">
														{compactId(ref.refId)}
													</td>
													<td className="px-2 py-1 text-right">
														<Button size="sm" onClick={() => expandRef(ref)}>
															Expand
														</Button>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
							{Object.values(expanded).map((entry) => (
								<div
									key={entry.refId}
									className="border border-sys-outline-soft"
								>
									<div className="border-b border-sys-outline-soft bg-sys-surface-low px-3 py-2 text-[0.75rem] font-semibold">
										{entry.kind} · {compactId(entry.refId)}
									</div>
									<JsonPreview value={entry.data ?? entry} />
								</div>
							))}
						</div>
					) : (
						<div className="mt-3 border border-sys-outline-soft bg-sys-surface-low">
							<EmptyState
								title="No Bundle Loaded"
								description="Choose an anchor and load its compact evidence bundle."
								tone="muted"
								className="items-start px-3 py-4 text-left"
							/>
						</div>
					)}
				</Card>

				<Card className="border border-sys-outline p-3">
					<SectionTitle title="Top Expanded Sources" />
					{loadingStats ? (
						<div className="mt-3 text-[0.8125rem] text-sys-on-surface-muted">
							Loading evidence telemetry…
						</div>
					) : statsError ? (
						<div className="mt-3 text-[0.8125rem] text-sys-danger">
							{statsError}
						</div>
					) : stats?.bySource.length ? (
						<div className="mt-2 space-y-2">
							{stats.bySource.map((row) => (
								<div
									key={`${row.source}:${row.kind}`}
									className="border border-sys-outline-soft bg-sys-surface p-2"
								>
									<div className="flex items-center justify-between gap-2">
										<span className="truncate text-[0.75rem] font-semibold">
											{row.source}
										</span>
										<span className="font-mono text-[0.75rem] text-sys-on-surface-muted">
											{row.kind}
										</span>
									</div>
									<div className="mt-1 text-[0.75rem] text-sys-on-surface-muted">
										{row.expansionCount.toLocaleString()} expanded ·{" "}
										{row.issuedCount.toLocaleString()} issued
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="mt-4">
							<EmptyState
								title="No Ref Telemetry"
								description={
									stats?.warning ??
									"No materialized evidence refs have been issued yet."
								}
							/>
						</div>
					)}
				</Card>
			</div>

			<div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
				<Card className="border border-sys-outline p-3">
					<SectionTitle title="Recent Refs" />
					<div className="mt-2 overflow-x-auto">
						<table className="w-full text-left text-[0.75rem]">
							<thead className="text-sys-on-surface-subtle">
								<tr className="border-b border-sys-outline-soft">
									<th className="px-2 py-1 font-semibold">Kind</th>
									<th className="px-2 py-1 font-semibold">Source</th>
									<th className="px-2 py-1 font-semibold">Ref</th>
									<th className="px-2 py-1 font-semibold">Anchor</th>
									<th className="px-2 py-1 font-semibold">Last Seen</th>
								</tr>
							</thead>
							<tbody>
								{stats?.recentRefs.length ? (
									stats.recentRefs.map((ref) => (
										<tr
											key={ref.refId}
											className="border-t border-sys-outline-soft"
										>
											<td className="whitespace-nowrap px-2 py-1 font-mono">
												{ref.kind}
											</td>
											<td className="whitespace-nowrap px-2 py-1">
												{ref.source}
											</td>
											<td
												className="whitespace-nowrap px-2 py-1 font-mono"
												title={ref.refId}
											>
												{compactId(ref.refId)}
											</td>
											<td
												className="whitespace-nowrap px-2 py-1 font-mono"
												title={`${ref.anchor.entityKind}:${ref.anchor.entityId}`}
											>
												{ref.anchor.entityKind}:{compactId(ref.anchor.entityId)}
											</td>
											<td className="whitespace-nowrap px-2 py-1">
												{new Date(ref.lastSeenAt).toLocaleString()}
											</td>
										</tr>
									))
								) : (
									<tr>
										<td colSpan={5}>
											<StateRow>No recent refs.</StateRow>
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</Card>
				<Card className="border border-sys-outline p-3">
					<SectionTitle title="Recent Expansions" />
					<div className="mt-2 overflow-x-auto">
						<table className="w-full text-left text-[0.75rem]">
							<thead className="text-sys-on-surface-subtle">
								<tr className="border-b border-sys-outline-soft">
									<th className="px-2 py-1 font-semibold">Kind</th>
									<th className="px-2 py-1 font-semibold">Operation</th>
									<th className="px-2 py-1 font-semibold">Status</th>
									<th className="px-2 py-1 font-semibold">Source</th>
									<th className="px-2 py-1 font-semibold">Ref</th>
									<th className="px-2 py-1 font-semibold">Expanded</th>
								</tr>
							</thead>
							<tbody>
								{stats?.recentExpansions.length ? (
									stats.recentExpansions.map((expansion) => (
										<tr
											key={expansion.id}
											className="border-t border-sys-outline-soft"
										>
											<td className="whitespace-nowrap px-2 py-1 font-mono">
												{expansion.kind}
											</td>
											<td className="whitespace-nowrap px-2 py-1">
												{expansion.operation}
											</td>
											<td className="whitespace-nowrap px-2 py-1">
												{expansion.resultStatus}
											</td>
											<td className="whitespace-nowrap px-2 py-1">
												{expansion.source ?? "unknown"}
											</td>
											<td
												className="whitespace-nowrap px-2 py-1 font-mono"
												title={expansion.refId}
											>
												{compactId(expansion.refId)}
											</td>
											<td className="whitespace-nowrap px-2 py-1">
												{new Date(expansion.expandedAt).toLocaleString()}
											</td>
										</tr>
									))
								) : (
									<tr>
										<td colSpan={6}>
											<StateRow>No recent expansions.</StateRow>
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</Card>
			</div>
		</div>
	);
}
