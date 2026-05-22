// ── Init ─────────────────────────────────────────────────────────────────────
export { type InitConfig, init, type Shutdown } from "./init.js";
// ── Interaction-id propagation (spec/interaction-id.md) ──────────────────────
export {
	currentInteractionId,
	INTERACTION_ATTRIBUTE,
	INTERACTION_HEADER,
	isValidInteractionId,
	stampInteractionFromRequest,
} from "./interaction.js";
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
