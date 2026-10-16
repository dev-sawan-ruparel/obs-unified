import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	ApproveCallbackFields,
	approveRemediationProposal,
	approveRemediationProposalDetailed,
	formatRemediationStateDiff,
	GrantDeliveryWarning,
	GrantTokenNotice,
	RemediationApprovalCard,
	RemediationApprovalQueue,
	type RemediationProposalView,
	rejectRemediationProposal,
	updateProposalById,
} from "./RemediationApprovalCard";

const samplePendingProposal: RemediationProposalView = {
	id: "rem_01",
	projectId: "default",
	environment: "prod",
	incidentId: "inc_01",
	findingId: "fnd_01",
	idempotencyKey: "idem_01",
	actionKind: "rollback_deploy",
	targetNodeId: "service:prod:default:checkout",
	expectedCurrentState: {
		version: "v2.4.1",
		commitSha: "a1b2c3d",
	},
	desiredTargetState: {
		version: "v2.4.0",
		commitSha: "9f8e7d6",
	},
	requestedAutonomy: "autonomous_write",
	effectiveAutonomy: "human_approved_write",
	policyDecisionReason:
		"Rollback in prod requires human approval unless counterfactual proof is verified",
	status: "pending_human_approval",
	grantExpiresAt: null,
	approvedByUserId: null,
	approvedAt: null,
	claimedByRunnerId: null,
	claimedAt: null,
	claimExpiresAt: null,
	remediationAgentRunId: null,
	resultingChangeId: null,
	failureReason: null,
	createdAt: "2026-10-15T04:00:00.000Z",
	updatedAt: "2026-10-15T04:00:00.000Z",
	expiresAt: "2026-10-15T04:30:00.000Z",
};

describe("RemediationApprovalCard & RemediationApprovalQueue", () => {
	it("computes expectedCurrentState vs desiredTargetState diff entries", () => {
		const diffs = formatRemediationStateDiff(
			samplePendingProposal.expectedCurrentState,
			samplePendingProposal.desiredTargetState,
		);
		expect(diffs).toEqual([
			{ field: "version", before: "v2.4.1", after: "v2.4.0" },
			{ field: "commitSha", before: "a1b2c3d", after: "9f8e7d6" },
		]);
	});

	it("renders pending_human_approval proposal details and Approve/Reject buttons", () => {
		const html = renderToStaticMarkup(
			createElement(RemediationApprovalCard, {
				proposal: samplePendingProposal,
			}),
		);

		expect(html).toContain("rollback_deploy");
		expect(html).toContain("env:prod");
		expect(html).toContain("service:prod:default:checkout");
		expect(html).toContain("human approved write");
		expect(html).toContain("pending_human_approval");
		expect(html).toContain(
			"Rollback in prod requires human approval unless counterfactual proof is verified",
		);
		expect(html).toContain("v2.4.1");
		expect(html).toContain("v2.4.0");
		expect(html).toContain("Finding: fnd_01");
		expect(html).toContain("Incident: inc_01");
		expect(html).toContain('data-action="approve-remediation"');
		expect(html).toContain('data-action="reject-remediation"');
	});

	it("renders recent completed and timed-out proposals with watchdog/recovery status", () => {
		const completedProposal: RemediationProposalView = {
			...samplePendingProposal,
			id: "rem_02",
			status: "completed",
			resultingChangeId: "chg_rollback_01",
			recoveryStatus: "recovered",
		};
		const timedOutProposal: RemediationProposalView = {
			...samplePendingProposal,
			id: "rem_03",
			status: "execution_timed_out",
			failureReason: "Claim lease expired after 10m",
		};

		const queueHtml = renderToStaticMarkup(
			createElement(RemediationApprovalQueue, {
				proposals: [samplePendingProposal, completedProposal, timedOutProposal],
			}),
		);

		expect(queueHtml).toContain("1 pending human approval · 3 total");
		expect(queueHtml).toContain("watchdog: recovered");
		expect(queueHtml).toContain("Change: chg_rollback_01");
		expect(queueHtml).toContain("watchdog: lease timed out");
		expect(queueHtml).toContain("Claim lease expired after 10m");
	});

	it("invokes POST /internal/remediations/:id/approve and /reject with credentials: include", async () => {
		const mockFetcher = vi.fn().mockImplementation(async (url: string) => {
			const isApprove = url.endsWith("/approve");
			return new Response(
				JSON.stringify({
					proposal: {
						...samplePendingProposal,
						status: isApprove ? "grant_issued" : "rejected",
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const approved = await approveRemediationProposal("rem_01", {
			basePath: "/internal",
			fetcher: mockFetcher as unknown as typeof fetch,
		});
		expect(approved?.status).toBe("grant_issued");
		expect(mockFetcher).toHaveBeenCalledWith(
			"/internal/remediations/rem_01/approve",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
			}),
		);

		const rejected = await rejectRemediationProposal(
			"rem_01",
			"False alarm during load test",
			{
				basePath: "/internal",
				fetcher: mockFetcher as unknown as typeof fetch,
			},
		);
		expect(rejected?.status).toBe("rejected");
		expect(mockFetcher).toHaveBeenCalledWith(
			"/internal/remediations/rem_01/reject",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				body: JSON.stringify({ reason: "False alarm during load test" }),
			}),
		);
	});

	it("renders an error banner on the card when an error is supplied", () => {
		const html = renderToStaticMarkup(
			createElement(RemediationApprovalCard, {
				proposal: samplePendingProposal,
				error: "Failed to approve remediation rem_01: 409",
			}),
		);
		expect(html).toContain("data-remediation-error");
		expect(html).toContain('role="alert"');
		expect(html).toContain("Failed to approve remediation rem_01: 409");
	});

	it("does not render an error banner by default and requires a confirm step", () => {
		const html = renderToStaticMarkup(
			createElement(RemediationApprovalCard, {
				proposal: samplePendingProposal,
			}),
		);
		expect(html).not.toContain("data-remediation-error");
		expect(html).not.toContain("confirm-approve-remediation");
		expect(html).not.toContain("data-reject-reason");
	});

	it("renders the grant token once with a copy button and one-time note", () => {
		const html = renderToStaticMarkup(
			createElement(RemediationApprovalCard, {
				proposal: { ...samplePendingProposal, status: "grant_issued" },
				grantToken: "grant_secret_123",
			}),
		);
		expect(html).toContain("grant_secret_123");
		expect(html).toContain('data-action="copy-grant-token"');
		expect(html).toMatch(/Shown only once/i);
		expect(
			renderToStaticMarkup(
				createElement(GrantTokenNotice, { token: "abc", onDismiss: () => {} }),
			),
		).toContain('data-action="dismiss-grant-token"');
	});

	it("extracts grantToken from the approve response", async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					proposal: { ...samplePendingProposal, status: "grant_issued" },
					grantToken: "tok_1",
				}),
				{ status: 200 },
			),
		);
		const out = await approveRemediationProposalDetailed("rem_01", {
			fetcher: fetcher as unknown as typeof fetch,
		});
		expect(out.grantToken).toBe("tok_1");
		expect(out.proposal?.status).toBe("grant_issued");
	});

	it("renders externally supplied proposals read-only when handlers are missing", () => {
		const html = renderToStaticMarkup(
			createElement(RemediationApprovalQueue, {
				proposals: [samplePendingProposal],
			}),
		);
		expect(html).toContain("rem_01");
		expect(html).not.toContain('data-action="approve-remediation"');
		const withHandlers = renderToStaticMarkup(
			createElement(RemediationApprovalQueue, {
				proposals: [samplePendingProposal],
				onApprove: () => {},
				onReject: () => {},
			}),
		);
		expect(withHandlers).toContain('data-action="approve-remediation"');
	});

	it("shows the stored grant callback host (never a URL) on pending proposals", () => {
		const html = renderToStaticMarkup(
			createElement(RemediationApprovalCard, {
				proposal: {
					...samplePendingProposal,
					callbackHost: "runner.example.com",
				},
			}),
		);
		expect(html).toContain(
			"Grant will also be delivered to runner.example.com",
		);
		expect(
			renderToStaticMarkup(
				createElement(RemediationApprovalCard, {
					proposal: samplePendingProposal,
				}),
			),
		).not.toContain("Grant will also be delivered");
	});

	it("highlights and lists first the deep-linked proposal in the queue", () => {
		const other = { ...samplePendingProposal, id: "rem_00" };
		const html = renderToStaticMarkup(
			createElement(RemediationApprovalQueue, {
				proposals: [other, samplePendingProposal],
				selectedProposalId: "rem_01",
			}),
		);
		expect(html).toContain('data-selected="true"');
		expect(html.indexOf('data-remediation-id="rem_01"')).toBeLessThan(
			html.indexOf('data-remediation-id="rem_00"'),
		);
		expect(html.match(/data-selected="true"/g)).toHaveLength(1);
		expect(html).not.toContain("max-h-[280px]");
		const plain = renderToStaticMarkup(
			createElement(RemediationApprovalQueue, { proposals: [other] }),
		);
		expect(plain).not.toContain("data-selected");
	});

	it("approve sends webhookUrl/secret only when a callback is supplied", async () => {
		const mk = () =>
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						proposal: { ...samplePendingProposal, status: "grant_issued" },
						grantToken: "tok_1",
						grantDelivery: {
							attempted: true,
							delivered: false,
							attempts: 3,
							host: "runner.example.com",
							error: "fetch failed",
						},
					}),
					{ status: 200 },
				),
			);
		const withCb = mk();
		const out = await approveRemediationProposalDetailed("rem_01", {
			fetcher: withCb as unknown as typeof fetch,
			callback: { webhookUrl: " https://runner.example.com/g ", secret: "s3" },
		});
		expect(JSON.parse(withCb.mock.calls[0][1].body)).toEqual({
			webhookUrl: "https://runner.example.com/g",
			secret: "s3",
		});
		expect(out.grantDelivery?.attempts).toBe(3);
		const without = mk();
		await approveRemediationProposalDetailed("rem_01", {
			fetcher: without as unknown as typeof fetch,
			callback: { webhookUrl: "  " },
		});
		expect(without.mock.calls[0][1].body).toBeUndefined();
	});

	it("renders callback fields with the stored host read-only and a password secret", () => {
		const html = renderToStaticMarkup(
			createElement(ApproveCallbackFields, {
				storedHost: "runner.example.com",
				url: "",
				secret: "",
				onUrlChange: () => {},
				onSecretChange: () => {},
			}),
		);
		expect(html).toContain("runner.example.com");
		expect(html).toContain("stored at propose time");
		expect(html).toContain('aria-label="Deliver grant to webhook URL"');
		expect(html).toMatch(
			/type="password"[^>]*data-callback-secret|data-callback-secret[^>]*type="password"/,
		);
		const bare = renderToStaticMarkup(
			createElement(ApproveCallbackFields, {
				url: "",
				secret: "",
				onUrlChange: () => {},
				onSecretChange: () => {},
			}),
		);
		expect(bare).not.toContain("stored at propose time");
	});

	it("warns on failed delivery alongside the token, and shows a queue badge", () => {
		const failed = {
			attempted: true,
			delivered: false,
			attempts: 3,
			host: "runner.example.com",
			error: "fetch failed",
		};
		const html = renderToStaticMarkup(
			createElement(RemediationApprovalCard, {
				proposal: { ...samplePendingProposal, status: "grant_issued" },
				grantToken: "rgt_abc",
				grantDelivery: failed,
			}),
		);
		expect(html).toContain(
			"Webhook delivery failed after 3 attempts: fetch failed. Copy the token below and hand it to the runner.",
		);
		expect(html).toContain("rgt_abc");
		for (const ok of [
			{ ...failed, delivered: true },
			{ ...failed, attempted: false },
		]) {
			expect(
				renderToStaticMarkup(
					createElement(GrantDeliveryWarning, { delivery: ok }),
				),
			).toBe("");
		}
		const badge = renderToStaticMarkup(
			createElement(RemediationApprovalQueue, {
				proposals: [
					{
						...samplePendingProposal,
						callbackDelivery: {
							status: "failed",
							attempts: 3,
							lastError: "x",
							at: "2026-10-15T04:00:00.000Z",
						},
					},
				],
			}),
		);
		expect(badge).toContain('data-callback-delivery="failed"');
		expect(badge).toContain("delivery failed");
		expect(
			renderToStaticMarkup(
				createElement(RemediationApprovalQueue, {
					proposals: [samplePendingProposal],
				}),
			),
		).not.toContain("data-callback-delivery");
	});
});

describe("updateProposalById", () => {
	it("updates only the matching proposal (also used for the deep-linked fetched card)", () => {
		const other = { ...samplePendingProposal, id: "rem_other" };
		const out = updateProposalById(
			[samplePendingProposal, other],
			samplePendingProposal.id,
			(p) => ({ ...p, status: "rejected" }),
		);
		expect(out[0].status).toBe("rejected");
		expect(out[1]).toBe(other);
		// The fetched deep-linked card is a one-element list in the same shape.
		expect(
			updateProposalById([samplePendingProposal], "nope", (p) => ({
				...p,
				status: "rejected",
			}))[0].status,
		).toBe("pending_human_approval");
	});
});
