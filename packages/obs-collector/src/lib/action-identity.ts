import type { JsonValue, StoredSpan } from "@obsunified/types";
import {
	ACTION_CAUSED_BY_ID_KEY,
	ACTION_CONFIDENCE_KEY,
	ACTION_ID_KEY,
	ACTION_ID_RE,
	ACTION_KIND_KEY,
	ACTION_ROOT_ID_KEY,
	ActionConfidence,
	AGENT_RUN_ID_KEY,
} from "@obsunified/types/constants";
import { sha256Hex } from "./hash";

export interface ResolvedActionIdentity {
	actionId: string;
	rootActionId: string;
	causedByActionId: string | null;
	agentRunId: string | null;
	confidence: ActionConfidence;
}

export async function deriveActionId(
	projectId: string,
	traceId: string,
	spanId: string,
): Promise<string> {
	const input = `${projectId}:${traceId}:${spanId}`;
	const hash = await sha256Hex(input);
	const hex = hash.substring(0, 32);
	let num = BigInt(`0x${hex}`);
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
	let encoded = "";
	for (let i = 0; i < 26; i++) {
		const remainder = Number(num % 32n);
		encoded = alphabet[remainder] + encoded;
		num = num / 32n;
	}
	return encoded;
}

export const asValidActionId = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return ACTION_ID_RE.test(trimmed) ? trimmed : undefined;
};

const asConfidence = (value: unknown): ActionConfidence | undefined =>
	value === ActionConfidence.Explicit || value === ActionConfidence.Fallback
		? value
		: undefined;

export async function resolveActionIdentity(
	span: Pick<StoredSpan, "projectId" | "traceId" | "spanId" | "parentSpanId">,
	attrs: Record<string, JsonValue>,
): Promise<ResolvedActionIdentity> {
	const explicitActionId = asValidActionId(attrs[ACTION_ID_KEY]);
	const actionId =
		explicitActionId ??
		(await deriveActionId(span.projectId, span.traceId, span.spanId));
	const confidence =
		asConfidence(attrs[ACTION_CONFIDENCE_KEY]) ??
		(explicitActionId ? ActionConfidence.Explicit : ActionConfidence.Fallback);
	const actionKind =
		typeof attrs[ACTION_KIND_KEY] === "string" ? attrs[ACTION_KIND_KEY] : null;

	const rootActionId =
		asValidActionId(attrs[ACTION_ROOT_ID_KEY]) ??
		asValidActionId(attrs[AGENT_RUN_ID_KEY]) ??
		asValidActionId(attrs["obs.action.agent_run_id"]) ??
		asValidActionId(attrs["obs.agent_run.id"]) ??
		(actionKind === "agent.run" || actionKind === "agent"
			? actionId
			: await deriveActionId(
					span.projectId,
					span.traceId,
					span.traceId.substring(0, 16),
				));

	const explicitCausedByActionId = asValidActionId(
		attrs[ACTION_CAUSED_BY_ID_KEY],
	);
	let causedByActionId: string | null;
	if (explicitCausedByActionId) {
		causedByActionId = explicitCausedByActionId;
	} else if (attrs[ACTION_CAUSED_BY_ID_KEY] === null) {
		causedByActionId = null;
	} else {
		causedByActionId = span.parentSpanId
			? await deriveActionId(span.projectId, span.traceId, span.parentSpanId)
			: null;
	}

	const agentRunId =
		asValidActionId(attrs[AGENT_RUN_ID_KEY]) ??
		asValidActionId(attrs["obs.action.agent_run_id"]) ??
		asValidActionId(attrs["obs.agent_run.id"]) ??
		(actionKind === "agent.run" || actionKind === "agent" ? actionId : null);

	return {
		actionId,
		rootActionId,
		causedByActionId,
		agentRunId,
		confidence,
	};
}
