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
	if (ex.toolCallId) return `#/tool-calls/${encodeURIComponent(ex.toolCallId)}`;
	if (ex.actionId) return `#/actions/${encodeURIComponent(ex.actionId)}`;
	if (ex.agentRunId) return `#/agent-runs/${encodeURIComponent(ex.agentRunId)}`;
	if (ex.evalId) return `#/evals/${encodeURIComponent(ex.evalId)}`;
	if (ex.traceId) return `#/traces?trace=${encodeURIComponent(ex.traceId)}`;
	return "";
}
