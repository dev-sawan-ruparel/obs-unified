// ── Init ─────────────────────────────────────────────────────────────────────
export { type InitConfig, init, type Shutdown } from "./init";

// ── LLM + tool spans (OpenInference) ─────────────────────────────────────────
export {
	type LLMOptions,
	type LLMSpanHandle,
	type ToolOptions,
	type ToolSpanHandle,
	withLLMSpan,
	withToolSpan,
} from "./llm";

// ── Project-id propagation ───────────────────────────────────────────────────
export {
	getProjectId,
	PROJECT_ID_ATTRIBUTE,
	PROJECT_ID_HEADER,
	setProjectId,
} from "./project";
