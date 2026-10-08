import {
	type SerializedActionContext,
	serializeActionContext,
	startAgentRun,
	step,
	withSerializedActionContext,
} from "@obsunified/telemetry-sdk";

type QueueJob = {
	name: string;
	payload: Record<string, unknown>;
	metadata?: {
		obsActionContext?: SerializedActionContext;
	};
};

const queue: QueueJob[] = [];

export async function produceInvoiceJob(invoiceId: string) {
	return startAgentRun(
		{
			agentId: "billing-agent",
			agentName: "Billing Agent",
			goal: "Prepare invoice update job",
		},
		async () => {
			await step({ name: "enqueue-invoice-update" }, async () => {
				queue.push({
					name: "invoice.update",
					payload: { invoiceId },
					metadata: {
						obsActionContext: serializeActionContext(),
					},
				});
			});
		},
	);
}

export async function consumeInvoiceJob(job: QueueJob) {
	return withSerializedActionContext(
		job.metadata?.obsActionContext,
		async () => {
			await step({ name: `consume-${job.name}` }, async (consumerStep) => {
				consumerStep.setAttribute("invoice.id", job.payload.invoiceId);
			});
		},
	);
}
