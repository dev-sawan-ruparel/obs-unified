import type { StoredSpan } from "@obsunified/types";

export interface ActionEnricherPlugin {
	name: string;
	enrichActionRecord?(
		record: Record<string, unknown>,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
	enrichAgentRunRecord?(
		record: Record<string, unknown>,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
	enrichToolCallRecord?(
		record: Record<string, unknown>,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
	enrichRetrievalRecord?(
		record: Record<string, unknown>,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
	enrichEvalRecord?(
		record: Record<string, unknown>,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
	enrichArtifactRecord?(
		record: Record<string, unknown>,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
}

export const enricherPlugins: ActionEnricherPlugin[] = [];

export function registerActionEnricherPlugin(plugin: ActionEnricherPlugin) {
	enricherPlugins.push(plugin);
}

export function clearActionEnricherPlugins() {
	enricherPlugins.length = 0;
}
