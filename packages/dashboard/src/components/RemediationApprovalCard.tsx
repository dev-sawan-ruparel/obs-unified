import type {
	RecoveryStatus,
	RemediationProposal,
	RemediationProposalStatus,
	RemediationStateSpec,
} from "@obsunified/types";
import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "../provider";
import { hashRoutes } from "../routes";
import { errorMessage, useApi } from "../use-api";
import { AutonomyBadge } from "./action-graph/badges";
import { normalizeConnectedHref } from "./ConnectedRail";
import { Card, SectionTitle } from "./primitives";

export interface RemediationProposalView extends RemediationProposal {
	recoveryStatus?: RecoveryStatus | null;
	watchdogStep?: number | null;
}

export interface RemediationStateDiffEntry {
	field: keyof RemediationStateSpec;
	before: string;
	after: string;
}

const STATE_FIELDS: Array<keyof RemediationStateSpec> = [
	"version",
	"commitSha",
	"configDigest",
	"flagKey",
	"flagVariant",
	"promptVersion",
	"branchOrPrUrl",
];

const formatStateVal = (val: unknown): string => {
	if (val === null || val === undefined || val === "") return "—";
	return String(val);
};

export function formatRemediationStateDiff(
	expected: RemediationStateSpec | null | undefined,
	desired: RemediationStateSpec | null | undefined,
): RemediationStateDiffEntry[] {
	const exp = expected ?? {};
	const des = desired ?? {};
	const diffs: RemediationStateDiffEntry[] = [];

	for (const field of STATE_FIELDS) {
		const bVal = exp[field];
		const aVal = des[field];
		if (
			(bVal !== null && bVal !== undefined && bVal !== "") ||
			(aVal !== null && aVal !== undefined && aVal !== "")
		) {
			diffs.push({
				field,
				before: formatStateVal(bVal),
				after: formatStateVal(aVal),
			});
		}
	}
	return diffs;
}

export interface RemediationApproveResult {
	proposal: RemediationProposalView | null;
	/** Single-use grant token. The collector only returns it on approval. */
	grantToken: string | null;
}

export async function approveRemediationProposalDetailed(
	id: string,
	options?: { basePath?: string; fetcher?: typeof fetch },
): Promise<RemediationApproveResult> {
	const basePath = (options?.basePath ?? "/internal").replace(/\/$/, "");
	const fn = options?.fetcher ?? fetch;
	const res = await fn(
		`${basePath}/remediations/${encodeURIComponent(id)}/approve`,
		{
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
		},
	);
	if (!res.ok) {
		throw new Error(`Failed to approve remediation ${id}: ${res.status}`);
	}
	const body = (await res.json().catch(() => null)) as
		| (RemediationProposalView & {
				proposal?: RemediationProposalView;
				grantToken?: string | null;
		  })
		| null;
	const proposal =
		body && typeof body === "object" && body.proposal
			? body.proposal
			: (body as RemediationProposalView | null);
	const grantToken =
		(body && typeof body === "object" && body.grantToken) ||
		proposal?.grantToken ||
		null;
	return { proposal, grantToken: grantToken || null };
}

export async function approveRemediationProposal(
	id: string,
	options?: { basePath?: string; fetcher?: typeof fetch },
): Promise<RemediationProposalView | null> {
	return (await approveRemediationProposalDetailed(id, options)).proposal;
}

export async function rejectRemediationProposal(
	id: string,
	reason = "Rejected by operator in Autonomous Review",
	options?: { basePath?: string; fetcher?: typeof fetch },
): Promise<RemediationProposalView | null> {
	const basePath = (options?.basePath ?? "/internal").replace(/\/$/, "");
	const fn = options?.fetcher ?? fetch;
	const res = await fn(
		`${basePath}/remediations/${encodeURIComponent(id)}/reject`,
		{
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ reason }),
		},
	);
	if (!res.ok) {
		throw new Error(`Failed to reject remediation ${id}: ${res.status}`);
	}
	const body = (await res.json().catch(() => null)) as
		| { proposal?: RemediationProposalView }
		| RemediationProposalView
		| null;
	if (body && typeof body === "object" && "proposal" in body && body.proposal) {
		return body.proposal;
	}
	return body as RemediationProposalView | null;
}

const statusTone = (status: RemediationProposalStatus): string => {
	switch (status) {
		case "pending_human_approval":
		case "proposed":
			return "bg-sys-warning/15 text-sys-warning border-sys-warning/30";
		case "grant_issued":
		case "claimed_executing":
			return "bg-sys-accent/15 text-sys-accent border-sys-accent/30";
		case "completed":
			return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
		case "rejected":
		case "failed_execution":
		case "execution_timed_out":
			return "bg-sys-error/15 text-sys-error border-sys-error/30";
		default:
			return "bg-sys-outline/15 text-sys-on-surface-muted border-sys-outline/30";
	}
};

const recoveryTone = (recovery: RecoveryStatus): string => {
	switch (recovery) {
		case "recovered":
			return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
		case "monitoring":
		case "inconclusive_low_traffic":
			return "bg-sys-warning/15 text-sys-warning border-sys-warning/30";
		case "still_degraded":
		case "regression_recurred":
			return "bg-sys-error/15 text-sys-error border-sys-error/30";
		default:
			return "bg-sys-outline/10 text-sys-on-surface-muted border-sys-outline/25";
	}
};

export interface RemediationApprovalCardProps {
	proposal: RemediationProposalView;
	onApprove?: (id: string) => unknown;
	onReject?: (id: string, reason?: string) => unknown;
	onNavigate?: (href: string) => void;
	busy?: boolean;
	/** Hide approve/reject controls (e.g. no handlers were supplied). */
	readOnly?: boolean;
	/** Controlled error message; overrides the card's own action error. */
	error?: string | null;
	/** Controlled one-time grant token; overrides the token from onApprove. */
	grantToken?: string | null;
}

const grantTokenFrom = (result: unknown): string | null => {
	if (result && typeof result === "object" && "grantToken" in result) {
		const token = (result as { grantToken?: unknown }).grantToken;
		return typeof token === "string" && token ? token : null;
	}
	return null;
};

export function GrantTokenNotice({
	token,
	onDismiss,
}: {
	token: string;
	onDismiss?: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(token);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	};
	return (
		<div
			data-grant-token
			className="border border-sys-warning/40 bg-sys-warning/10 p-2 font-mono text-[0.6875rem] flex flex-col gap-1"
		>
			<div className="font-semibold text-sys-warning">
				Grant token. Shown only once; copy it now, it cannot be retrieved again.
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<code data-grant-token-value className="break-all select-all">
					{token}
				</code>
				<button
					type="button"
					data-action="copy-grant-token"
					onClick={copy}
					className="px-2 py-0.5 border border-sys-outline cursor-pointer"
				>
					{copied ? "Copied" : "Copy"}
				</button>
				{onDismiss && (
					<button
						type="button"
						data-action="dismiss-grant-token"
						onClick={onDismiss}
						className="px-2 py-0.5 border border-sys-outline cursor-pointer"
					>
						Dismiss
					</button>
				)}
			</div>
		</div>
	);
}

const triggerHref = (href: string, onNavigate?: (href: string) => void) => {
	const normalized = normalizeConnectedHref(href);
	if (onNavigate) {
		onNavigate(normalized);
		return;
	}
	if (typeof location !== "undefined") {
		if (normalized.startsWith("#")) {
			location.hash = normalized.slice(1);
		} else {
			location.href = normalized;
		}
	}
};

export function RemediationApprovalCard({
	proposal,
	onApprove,
	onReject,
	onNavigate,
	busy = false,
	readOnly = false,
	error,
	grantToken,
}: RemediationApprovalCardProps) {
	const [confirming, setConfirming] = useState<"approve" | "reject" | null>(
		null,
	);
	const [reason, setReason] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [issuedToken, setIssuedToken] = useState<string | null>(null);
	const shownError = error !== undefined ? error : actionError;
	const shownToken = grantToken !== undefined ? grantToken : issuedToken;
	const controlsDisabled = busy || submitting;

	const runApprove = async () => {
		setSubmitting(true);
		setActionError(null);
		try {
			const result = await onApprove?.(proposal.id);
			setIssuedToken(grantTokenFrom(result));
			setConfirming(null);
		} catch (err) {
			setActionError(errorMessage(err));
		} finally {
			setSubmitting(false);
		}
	};

	const runReject = async () => {
		setSubmitting(true);
		setActionError(null);
		try {
			await onReject?.(proposal.id, reason.trim());
			setConfirming(null);
			setReason("");
		} catch (err) {
			setActionError(errorMessage(err));
		} finally {
			setSubmitting(false);
		}
	};

	const diffs = formatRemediationStateDiff(
		proposal.expectedCurrentState,
		proposal.desiredTargetState,
	);
	const isPendingApproval = proposal.status === "pending_human_approval";
	const showWatchdogTimeout = proposal.status === "execution_timed_out";

	return (
		<div
			data-remediation-id={proposal.id}
			data-remediation-status={proposal.status}
			className="border border-sys-outline bg-sys-surface p-3 flex flex-col gap-2 text-[0.75rem]"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="px-1.5 py-0.5 font-mono font-bold uppercase text-[0.625rem] bg-sys-surface-high border border-sys-outline text-sys-on-surface">
						{proposal.actionKind}
					</span>
					<span className="px-1.5 py-0.5 font-mono font-bold uppercase text-[0.625rem] bg-sys-primary/10 border border-sys-primary/25 text-sys-primary">
						env:{proposal.environment}
					</span>
					<span className="font-mono font-semibold text-sys-on-surface break-all">
						{proposal.targetNodeId}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					<AutonomyBadge level={proposal.effectiveAutonomy} />
					<span
						className={`px-2 py-0.5 rounded-sm font-mono font-bold uppercase text-[0.625rem] border ${statusTone(
							proposal.status,
						)}`}
					>
						{proposal.status}
					</span>
					{proposal.recoveryStatus &&
						proposal.recoveryStatus !== "not_applicable" && (
							<span
								data-recovery-status={proposal.recoveryStatus}
								className={`px-2 py-0.5 rounded-sm font-mono font-bold uppercase text-[0.625rem] border ${recoveryTone(
									proposal.recoveryStatus,
								)}`}
							>
								watchdog: {proposal.recoveryStatus}
							</span>
						)}
					{showWatchdogTimeout && !proposal.recoveryStatus && (
						<span
							data-watchdog-status="execution_timed_out"
							className="px-2 py-0.5 rounded-sm font-mono font-bold uppercase text-[0.625rem] border bg-sys-error/15 text-sys-error border-sys-error/30"
						>
							watchdog: lease timed out
						</span>
					)}
				</div>
			</div>

			<div className="text-[0.6875rem] text-sys-on-surface-muted font-mono">
				<span className="font-semibold text-sys-on-surface">
					Policy Decision:
				</span>{" "}
				{proposal.policyDecisionReason}
				{proposal.failureReason && (
					<span className="ml-2 text-sys-error font-semibold">
						· Failure: {proposal.failureReason}
					</span>
				)}
			</div>

			{diffs.length > 0 && (
				<div className="bg-sys-surface-low border border-sys-outline-soft p-2 font-mono text-[0.6875rem]">
					<div className="text-[0.5625rem] uppercase font-bold tracking-[0.05em] opacity-60 mb-1">
						Expected Current State → Desired Target State
					</div>
					<div className="flex flex-col gap-1">
						{diffs.map((d) => (
							<div key={d.field} className="flex items-center gap-2">
								<span className="font-semibold opacity-75 min-w-[100px]">
									{d.field}:
								</span>
								<span className="line-through opacity-70 text-sys-error">
									{d.before}
								</span>
								<span aria-hidden="true">→</span>
								<span className="font-bold text-sys-primary">{d.after}</span>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-sys-outline-soft">
				<div className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem]">
					<button
						type="button"
						onClick={() =>
							triggerHref(hashRoutes.finding(proposal.findingId), onNavigate)
						}
						className="underline hover:text-sys-primary cursor-pointer"
					>
						Finding: {proposal.findingId}
					</button>
					<span className="opacity-40">·</span>
					<button
						type="button"
						onClick={() =>
							triggerHref(hashRoutes.incident(proposal.incidentId), onNavigate)
						}
						className="underline hover:text-sys-primary cursor-pointer"
					>
						Incident: {proposal.incidentId}
					</button>
					{proposal.resultingChangeId && (
						<>
							<span className="opacity-40">·</span>
							<button
								type="button"
								onClick={() =>
									triggerHref(
										hashRoutes.change(proposal.resultingChangeId ?? ""),
										onNavigate,
									)
								}
								className="underline hover:text-sys-primary cursor-pointer"
							>
								Change: {proposal.resultingChangeId}
							</button>
						</>
					)}
				</div>

				{isPendingApproval && !readOnly && (
					<div className="flex flex-wrap items-center gap-2">
						{confirming === null && (
							<>
								<button
									type="button"
									disabled={controlsDisabled}
									data-action="approve-remediation"
									onClick={() => setConfirming("approve")}
									className="px-2.5 py-1 text-[0.6875rem] font-mono font-bold uppercase bg-sys-primary text-white border border-sys-primary hover:opacity-90 cursor-pointer disabled:opacity-50"
								>
									Approve
								</button>
								<button
									type="button"
									disabled={controlsDisabled}
									data-action="reject-remediation"
									onClick={() => setConfirming("reject")}
									className="px-2.5 py-1 text-[0.6875rem] font-mono font-bold uppercase bg-sys-error/15 text-sys-error border border-sys-error/40 hover:bg-sys-error hover:text-white cursor-pointer disabled:opacity-50"
								>
									Reject
								</button>
							</>
						)}
						{confirming === "approve" && (
							<>
								<span
									data-confirm-approve
									className="font-mono text-[0.6875rem] text-sys-warning font-semibold"
								>
									This authorizes a production change. Confirm?
								</span>
								<button
									type="button"
									disabled={controlsDisabled}
									data-action="confirm-approve-remediation"
									onClick={runApprove}
									className="px-2.5 py-1 text-[0.6875rem] font-mono font-bold uppercase bg-sys-primary text-white border border-sys-primary cursor-pointer disabled:opacity-50"
								>
									Confirm approve
								</button>
								<button
									type="button"
									disabled={controlsDisabled}
									onClick={() => setConfirming(null)}
									className="px-2.5 py-1 text-[0.6875rem] font-mono uppercase border border-sys-outline cursor-pointer"
								>
									Cancel
								</button>
							</>
						)}
						{confirming === "reject" && (
							<>
								<input
									type="text"
									data-reject-reason
									aria-label="Rejection reason"
									placeholder="Reason for rejecting"
									value={reason}
									onChange={(e) => setReason(e.target.value)}
									className="px-2 py-1 text-[0.6875rem] font-mono border border-sys-outline bg-sys-surface"
								/>
								<button
									type="button"
									disabled={controlsDisabled || reason.trim() === ""}
									data-action="confirm-reject-remediation"
									onClick={runReject}
									className="px-2.5 py-1 text-[0.6875rem] font-mono font-bold uppercase bg-sys-error/15 text-sys-error border border-sys-error/40 cursor-pointer disabled:opacity-50"
								>
									Confirm reject
								</button>
								<button
									type="button"
									disabled={controlsDisabled}
									onClick={() => setConfirming(null)}
									className="px-2.5 py-1 text-[0.6875rem] font-mono uppercase border border-sys-outline cursor-pointer"
								>
									Cancel
								</button>
							</>
						)}
					</div>
				)}
			</div>

			{shownError && (
				<div
					role="alert"
					data-remediation-error
					className="px-2 py-1 font-mono text-[0.6875rem] text-sys-error bg-sys-error/10 border border-sys-error/30"
				>
					{shownError}
				</div>
			)}
			{shownToken && (
				<GrantTokenNotice
					token={shownToken}
					onDismiss={
						grantToken === undefined ? () => setIssuedToken(null) : undefined
					}
				/>
			)}
		</div>
	);
}

export interface RemediationApprovalQueueProps {
	proposals?: RemediationProposalView[];
	/**
	 * When `proposals` is supplied the queue does no fetching of its own (and
	 * has no project-scoped fetcher). Supply both handlers to enable actions;
	 * otherwise the cards render read-only.
	 */
	onApprove?: (id: string) => unknown;
	onReject?: (id: string, reason?: string) => unknown;
	onNavigate?: (href: string) => void;
}

function RemediationApprovalQueueContent({
	proposals,
	busyId,
	readOnly,
	onApprove,
	onReject,
	onNavigate,
}: {
	proposals: RemediationProposalView[];
	busyId?: string | null;
	readOnly?: boolean;
	onApprove?: (id: string) => unknown;
	onReject?: (id: string, reason?: string) => unknown;
	onNavigate?: (href: string) => void;
}) {
	if (proposals.length === 0) {
		return null;
	}

	const pendingCount = proposals.filter(
		(p) => p.status === "pending_human_approval",
	).length;

	return (
		<Card className="mb-2 p-3 flex-none">
			<SectionTitle
				title="AutoSRE Remediation Proposals & Human Approval Queue"
				note={`${pendingCount} pending human approval · ${proposals.length} total`}
			/>
			<div className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-2 max-h-[280px] overflow-y-auto">
				{proposals.map((proposal) => (
					<RemediationApprovalCard
						key={proposal.id}
						proposal={proposal}
						busy={busyId === proposal.id}
						readOnly={readOnly}
						onApprove={onApprove}
						onReject={onReject}
						onNavigate={onNavigate}
					/>
				))}
			</div>
		</Card>
	);
}

function AutoFetchedRemediationApprovalQueue({
	onApprove: externalApprove,
	onReject: externalReject,
	onNavigate,
}: Omit<RemediationApprovalQueueProps, "proposals">) {
	const { basePath, fetcher } = useDashboard();
	const api = useApi();
	const [proposals, setProposals] = useState<RemediationProposalView[]>([]);
	const [busyId, setBusyId] = useState<string | null>(null);

	useEffect(() => {
		let active = true;
		api<
			| {
					proposals?: RemediationProposalView[];
					rows?: RemediationProposalView[];
			  }
			| RemediationProposalView[]
			| null
		>("/remediations")
			.then((body) => {
				if (Array.isArray(body)) return body;
				if (body && Array.isArray(body.proposals)) return body.proposals;
				if (body && Array.isArray(body.rows)) return body.rows;
				return [];
			})
			.then((list) => {
				if (active) setProposals(list);
			})
			.catch(() => {
				if (active) setProposals([]);
			});
		return () => {
			active = false;
		};
	}, [api]);

	// Handlers rethrow so the card can render the failure to the operator.
	const handleApprove = useCallback(
		async (id: string) => {
			if (externalApprove) return externalApprove(id);
			setBusyId(id);
			try {
				const { proposal, grantToken } =
					await approveRemediationProposalDetailed(id, { basePath, fetcher });
				setProposals((prev) =>
					prev.map((p) =>
						p.id === id ? (proposal ?? { ...p, status: "grant_issued" }) : p,
					),
				);
				return { grantToken };
			} finally {
				setBusyId(null);
			}
		},
		[basePath, externalApprove, fetcher],
	);

	const handleReject = useCallback(
		async (id: string, reason?: string) => {
			if (externalReject) return externalReject(id, reason);
			setBusyId(id);
			try {
				const updated = await rejectRemediationProposal(id, reason, {
					basePath,
					fetcher,
				});
				setProposals((prev) =>
					prev.map((p) =>
						p.id === id ? (updated ?? { ...p, status: "rejected" }) : p,
					),
				);
			} finally {
				setBusyId(null);
			}
		},
		[basePath, externalReject, fetcher],
	);

	return (
		<RemediationApprovalQueueContent
			proposals={proposals}
			busyId={busyId}
			onApprove={handleApprove}
			onReject={handleReject}
			onNavigate={onNavigate}
		/>
	);
}

export function RemediationApprovalQueue(props: RemediationApprovalQueueProps) {
	if (props.proposals !== undefined) {
		// Externally supplied proposals: never fall back to bare fetch(), which
		// would drop the project-scoped fetcher (X-Project-Id). Without both
		// handlers the cards are read-only.
		const readOnly = !props.onApprove || !props.onReject;
		return (
			<RemediationApprovalQueueContent
				proposals={props.proposals}
				readOnly={readOnly}
				onApprove={props.onApprove}
				onReject={props.onReject}
				onNavigate={props.onNavigate}
			/>
		);
	}
	return <AutoFetchedRemediationApprovalQueue {...props} />;
}
