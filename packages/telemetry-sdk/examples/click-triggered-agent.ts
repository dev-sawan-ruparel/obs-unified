import {
	createRequestSpan,
	runWithSpan,
	startAgentRun,
	withAction,
} from "@obsunified/telemetry-sdk";
import {
	ACTION_HEADER_NAME,
	ACTION_ROOT_HEADER_NAME,
} from "@obsunified/types/constants";

type RequestLike = {
	headers: {
		get(name: string): string | null;
	};
};

export async function handleClickTriggeredAgent(req: RequestLike) {
	const inboundRootActionId = req.headers.get(ACTION_ROOT_HEADER_NAME);
	const inboundActionId = req.headers.get(ACTION_HEADER_NAME);
	const requestSpan = createRequestSpan("billing-api", "POST /agent/run");

	return runWithSpan(requestSpan, async () =>
		withAction(
			{
				rootActionId: inboundRootActionId ?? undefined,
				actionId: inboundActionId ?? undefined,
				actorType: "user",
			},
			async () =>
				startAgentRun(
					{
						agentId: "billing-agent",
						agentName: "Billing Agent",
						goal: "Resolve invoice update requested from browser click",
						autonomyLevel: "suggested_action",
					},
					async (run) => {
						await run.step({ name: "triage-click-context" }, async (step) => {
							step.setAttribute("obs.trigger.type", "browser.click");
						});
						run.setOutcome("Prepared suggested invoice update.");
						return { runId: run.runId };
					},
				),
		),
	);
}
