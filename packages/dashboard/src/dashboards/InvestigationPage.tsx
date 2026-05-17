import type {
	AnalysisDefinition,
	AnalysisResult,
	AnalysisResultResponse,
	AnalysisStatus,
} from "@obs-unified/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectedRail } from "../components/ConnectedRail";
import { Tag, type TagTone } from "../components/Tag";
import { useApi, useRawFetch } from "../use-api";

/**
 * RFC 0002 Stage 4 — investigation page.
 *
 * Layout (top to bottom): header (title + status + Re-run + Back), narrative
 * card (the answer), evidence tables, footer with the permalink. The
 * narrative is the lede — the tables are below for users who want to verify.
 *
 * "Re-run" hits POST /internal/analyses/:id/run, which executes the SQL
 * right now and persists. We deliberately don't run the narrate pass on
 * the on-demand path (no surprise LLM bills from button clicks); the page
 * shows whatever narrative the most recent cron tick produced.
 */

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

interface EvidenceTable {
	title?: string;
	headers: string[];
	rows: Array<Array<string | number | boolean | null>>;
	note?: string;
}

const isEvidenceTable = (v: unknown): v is EvidenceTable => {
	if (!v || typeof v !== "object" || Array.isArray(v)) return false;
	const o = v as Record<string, unknown>;
	return Array.isArray(o.headers) && Array.isArray(o.rows);
};

const renderCell = (
	cell: string | number | boolean | null,
): string => {
	if (cell === null || cell === undefined) return "—";
	if (typeof cell === "boolean") return cell ? "yes" : "no";
	return String(cell);
};

function EvidenceTableView({
	name,
	table,
}: {
	name: string;
	table: EvidenceTable;
}) {
	return (
		<section
			className="bg-sys-surface border border-sys-outline-soft"
			data-test-evidence={name}
		>
			<header className="px-3 pt-2 pb-1 border-b border-sys-outline-soft">
				<h3 className="text-[0.8125rem] font-semibold m-0">
					{table.title ?? name}
				</h3>
				{table.note ? (
					<p className="text-[0.6875rem] text-sys-on-surface-muted m-0 mt-0.5">
						{table.note}
					</p>
				) : null}
			</header>
			<div className="overflow-x-auto">
				<table className="w-full text-[0.75rem] font-mono">
					<thead>
						<tr className="text-left text-sys-on-surface-muted border-b border-sys-outline-soft">
							{table.headers.map((h) => (
								<th key={h} className="px-3 py-1.5 font-semibold">
									{h}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{table.rows.length === 0 ? (
							<tr>
								<td
									colSpan={table.headers.length}
									className="px-3 py-2 text-sys-on-surface-subtle italic"
								>
									no rows
								</td>
							</tr>
						) : (
							table.rows.map((row, i) => (
								<tr
									key={i}
									className="border-b border-sys-outline-soft/40 last:border-b-0"
								>
									{row.map((cell, j) => (
										<td key={j} className="px-3 py-1 align-top">
											{renderCell(cell)}
										</td>
									))}
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function narrativeBorderClass(status: AnalysisStatus): string {
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
}

export function InvestigationPage({
	investigationId,
	onNavigate,
}: {
	investigationId: string;
	onNavigate: (route: {
		tab?: string;
		investigationId?: string;
	}) => void;
}) {
	const api = useApi();
	const rawFetch = useRawFetch();
	const [definition, setDefinition] = useState<AnalysisDefinition | null>(null);
	const [result, setResult] = useState<AnalysisResult | null>(null);
	const [loading, setLoading] = useState(true);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			setLoading(true);
			const res = await api<AnalysisResultResponse>(
				`/analyses/${encodeURIComponent(investigationId)}/result`,
			);
			setDefinition(res.definition);
			setResult(res.result);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, [api, investigationId]);

	useEffect(() => {
		load();
	}, [load]);

	const onRerun = useCallback(async () => {
		setRunning(true);
		try {
			const res = await rawFetch(
				`/analyses/${encodeURIComponent(investigationId)}/run`,
				{ method: "POST" },
			);
			if (!res.ok) {
				throw new Error(`re-run failed: ${res.status}`);
			}
			const body = (await res.json()) as AnalysisResultResponse;
			setDefinition(body.definition);
			setResult(body.result);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setRunning(false);
		}
	}, [rawFetch, investigationId]);

	const evidence = useMemo(() => {
		const ev = result?.payload?.evidence;
		if (!ev || typeof ev !== "object" || Array.isArray(ev)) return [];
		return Object.entries(ev as Record<string, unknown>)
			.filter(([, v]) => isEvidenceTable(v))
			.map(([name, v]) => [name, v as EvidenceTable] as const);
	}, [result]);

	if (loading) {
		return (
			<div className="p-3 text-[0.8125rem] text-sys-on-surface-muted">
				Loading…
			</div>
		);
	}

	if (error || !definition) {
		return (
			<div className="p-3">
				<button
					type="button"
					onClick={() => onNavigate({ tab: "investigate", investigationId: undefined })}
					className="text-[0.75rem] text-sys-on-surface-muted hover:text-sys-on-surface mb-3"
				>
					← Back
				</button>
				<div className="bg-sys-error/10 border-l-[4px] border-sys-error p-3">
					<p className="text-[0.8125rem] font-medium text-sys-error m-0">
						{error ?? "Investigation not found"}
					</p>
				</div>
			</div>
		);
	}

	const status: AnalysisStatus = result?.status ?? "unknown";

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-y-auto">
			{/* Header */}
			<div className="mb-2 flex flex-none items-center gap-3 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
				<button
					type="button"
					onClick={() =>
						onNavigate({ tab: "investigate", investigationId: undefined })
					}
					className="text-[0.75rem] text-sys-on-surface-muted hover:text-sys-on-surface"
					data-test-back
				>
					← Back
				</button>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
					{definition.title}
				</span>
				<Tag tone={STATUS_TONE[status]} pulse={status === "critical"}>
					{STATUS_LABEL[status]}
				</Tag>
				<div className="ml-auto flex items-center gap-2">
					<button
						type="button"
						onClick={onRerun}
						disabled={running}
						className="text-[0.75rem] px-2 py-1 border border-sys-outline-soft hover:bg-sys-surface-low disabled:opacity-50"
						data-test-rerun
					>
						{running ? "Running…" : "Re-run"}
					</button>
				</div>
			</div>

			{/* Narrative — the lede */}
			{result?.narrative ? (
				<div
					className={`mb-2 border-l-[3px] pl-3 py-2 bg-sys-surface text-[0.8125rem] leading-relaxed ${narrativeBorderClass(status)}`}
					data-test-narrative
				>
					{result.narrative}
				</div>
			) : (
				<div
					className="mb-2 border-l-[3px] pl-3 py-2 bg-sys-surface text-[0.8125rem] leading-relaxed border-l-sys-outline text-sys-on-surface-muted italic"
					data-test-narrative
				>
					No narrative yet — the cron tick hasn't produced one for this run.
					Re-run to refresh data; narratives generate on the next scheduled
					tick when the gate predicate fires.
				</div>
			)}

			{/* Evidence */}
			{evidence.length === 0 ? (
				<div className="bg-sys-surface border border-sys-outline-soft p-3 text-[0.75rem] text-sys-on-surface-muted">
					No evidence rows produced. The query may have returned an empty
					window — try widening the time range or re-running.
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{evidence.map(([name, table]) => (
						<EvidenceTableView key={name} name={name} table={table} />
					))}
				</div>
			)}

			{/* Footer */}
			<div className="mt-2 text-[0.625rem] text-sys-on-surface-subtle font-mono">
				{definition.id} ·{" "}
				{result
					? `last run ${new Date(result.generatedAt).toLocaleString()}`
					: "never run"}
			</div>

			{/* RFC 0006 — connected rail. Investigations are topic-related,
			    not identity-related; the rail surfaces alerts bound to this
			    analysis and recent narratives via the manifest endpoint. */}
			<div className="mt-3">
				<ConnectedRail
					entityKind="analysis"
					entityId={definition.id}
				/>
			</div>
		</div>
	);
}

export default InvestigationPage;
