import { dashboardRouteToHref } from "@obsunified/types";

export interface AggregateExemplar {
	actionId: string;
	agentRunId: string | null;
	traceId: string | null;
	toolCallId: string | null;
	evalId: string | null;
	label: string | null;
	status: string | null;
	occurredAt: string | null;
}

export function resolveExemplarLink(ex: Partial<AggregateExemplar>): string {
	if (ex.toolCallId) {
		return dashboardRouteToHref({
			tab: "tool-calls",
			toolCallId: ex.toolCallId,
		});
	}
	if (ex.actionId) {
		return dashboardRouteToHref({ tab: "actions", actionId: ex.actionId });
	}
	if (ex.agentRunId) {
		return dashboardRouteToHref({
			tab: "agent-runs",
			agentRunId: ex.agentRunId,
		});
	}
	if (ex.evalId) {
		return dashboardRouteToHref({
			tab: "evaluations",
			evaluationId: ex.evalId,
		});
	}
	if (ex.traceId) {
		return dashboardRouteToHref({ tab: "traces", traceId: ex.traceId });
	}
	return "";
}
