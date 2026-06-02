import type { AskEvidence, EvidenceReference } from "@obs-unified/types";

const analysisRoute = (analysisId: string) =>
	`#/investigate/${encodeURIComponent(analysisId)}`;

export const analysisEvidenceReference = (
	evidence: AskEvidence,
): EvidenceReference => {
	const route = analysisRoute(evidence.analysisId);
	const status = evidence.result?.status ?? "unknown";
	return {
		evidenceId: `ask:analysis:${evidence.analysisId}`,
		entityKind: "analysis",
		entityId: evidence.analysisId,
		route,
		source: "ask.run_analysis",
		confidence: evidence.result ? 1 : 0.55,
		reason: evidence.result
			? `Ask consulted analysis "${evidence.definition.title}" with latest status ${status}.`
			: `Ask consulted analysis "${evidence.definition.title}", but no latest result was available.`,
		citations: [
			{
				label: evidence.definition.title,
				entityKind: "analysis",
				entityId: evidence.analysisId,
				route,
			},
		],
		suggestedNextPivots: [
			{
				label: "Open investigation",
				entityKind: "analysis",
				entityId: evidence.analysisId,
				route,
				reason:
					"Review the analysis payload, narrative, and connected telemetry rail.",
			},
		],
	};
};

export const askEvidenceReferences = (
	evidence: Iterable<AskEvidence>,
): EvidenceReference[] =>
	[...evidence].map((item) => analysisEvidenceReference(item));
