import {
	createRequestSpan,
	runWithSpan,
	startAgentRun,
} from "@obsunified/telemetry-sdk";

async function main() {
	const requestSpan = createRequestSpan("billing-api", "POST /agents/billing");

	await runWithSpan(requestSpan, async () => {
		await startAgentRun(
			{
				agentId: "billing-agent",
				agentName: "Billing Agent",
				agentVersion: "2026.05.31",
				goal: "Resolve invoice billing address discrepancy",
				autonomyLevel: "human_approved_write",
			},
			async (run) => {
				await run.step({ name: "classify-intent" }, async (step) => {
					step.setAttribute("obs.intent", "billing_address_update");
				});

				await run.recordRetrieval(
					{
						retrieverName: "invoice-policy-index",
						query: "billing address update policy",
					},
					async (retriever) => {
						retriever.addDocuments([
							{
								id: "policy/invoices/address-updates",
								score: 0.94,
								metadata: { source: "policy" },
							},
						]);
						retriever.setMaxRelevanceScore(0.94);
					},
				);

				await run.llm(
					{
						model: "gpt-4o-mini",
						provider: "openai",
						promptVersion: "billing-intent-v3",
						input: [{ role: "user", content: "Please update my invoice." }],
					},
					async (llm) => {
						llm.setTokens({ prompt: 132, completion: 44, total: 176 });
						llm.setCost(0.0018);
						llm.setOutput({ intent: "billing_address_update" });
					},
				);

				await run.tool(
					{
						name: "billing.update_invoice_address",
						arguments: { invoiceId: "inv_123", customerId: "cus_456" },
						sideEffect: true,
						approvalState: "human_approved",
					},
					async (toolCall) => {
						toolCall.setResult({ status: "updated" });
					},
				);

				await run.recordEvaluation({
					evaluatorName: "invoice-policy-check",
					evaluatorVersion: "1.0.0",
					passed: true,
					score: 1,
					reasoning: "The invoice update had human approval.",
				});

				run.setOutcome("Invoice billing address updated after approval.");
			},
		);
	});
}

void main();
