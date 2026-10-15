// ── Init ─────────────────────────────────────────────────────────────────────
export {
	buildResourceAttributes,
	type InitConfig,
	init,
	type Shutdown,
} from "./init.js";
// ── Interaction-id propagation (spec/interaction-id.md) ──────────────────────
export {
	currentInteractionId,
	INTERACTION_ATTRIBUTE,
	INTERACTION_HEADER,
	isValidInteractionId,
	stampInteractionFromRequest,
} from "./interaction.js";
// ── Runtime lineage & feature flag recording (RFC 0013) ──────────────────────
export {
	buildLineageAttributes,
	clearRecordedFeatureFlags,
	getConfiguredLineage,
	getRecordedFeatureFlagEntries,
	getRecordedFeatureFlags,
	type ObservabilityLineageConfig,
	type RecordedFeatureFlag,
	type RecordFeatureFlagOptions,
	recordFeatureFlag,
	resolveLineageConfig,
	setConfiguredLineage,
	stampActiveFeatureFlagsAndLineage,
	withFeatureFlagScope,
} from "./lineage.js";
// ── LLM + tool spans (OpenInference) ─────────────────────────────────────────
export {
	type LLMOptions,
	type LLMSpanHandle,
	type ToolOptions,
	type ToolSpanHandle,
	withLLMSpan,
	withToolSpan,
} from "./llm.js";
// ── Project-id propagation ───────────────────────────────────────────────────
export {
	getProjectId,
	PROJECT_ID_ATTRIBUTE,
	PROJECT_ID_HEADER,
	setProjectId,
} from "./project.js";
