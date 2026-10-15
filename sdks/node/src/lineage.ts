import { AsyncLocalStorage } from "node:async_hooks";
import {
	buildLineageAttributesFromSources,
	type LineageConfigInput,
	type LineageEnv,
	normalizeLineageInput,
	type ObservabilityLineageConfig,
	type RecordedFeatureFlag,
	type RecordFeatureFlagOptions,
	resolveLineageFromSources,
} from "@obsunified/types/lineage";
import { type Span, trace } from "@opentelemetry/api";

export type {
	LineageConfigInput,
	ObservabilityLineageConfig,
	RecordedFeatureFlag,
	RecordFeatureFlagOptions,
};

let configuredLineage: ObservabilityLineageConfig | undefined;

const defaultEnv = (): LineageEnv => {
	if (typeof process !== "undefined" && process?.env) {
		return process.env;
	}
	return {};
};

export function setConfiguredLineage(config?: LineageConfigInput): void {
	configuredLineage = config ? normalizeLineageInput(config) : undefined;
}

export function getConfiguredLineage(): ObservabilityLineageConfig | undefined {
	return configuredLineage ? { ...configuredLineage } : undefined;
}

export function resolveLineageConfig(
	config?: LineageConfigInput,
	env: LineageEnv = defaultEnv(),
): ObservabilityLineageConfig {
	return resolveLineageFromSources(config, env, configuredLineage);
}

export function buildLineageAttributes(
	config?: LineageConfigInput,
	env: LineageEnv = defaultEnv(),
): Record<string, string> {
	const attributes = buildLineageAttributesFromSources(
		config,
		env,
		configuredLineage,
	);
	// Node-only legacy key kept for resource-attribute consumers.
	const environment = attributes["deployment.environment.name"];
	return environment
		? { "deployment.environment": environment, ...attributes }
		: attributes;
}

// ── Feature Flag Evaluation Recording (RFC 0013 § 2.A) ──────────────────────

const featureFlagStorage = new AsyncLocalStorage<
	Map<string, RecordedFeatureFlag>
>();

export function applyFeatureFlagToOtelSpan(
	span: Span,
	flag: RecordedFeatureFlag,
	emitEvent = true,
): void {
	const isRec =
		typeof span.isRecording === "function" ? span.isRecording() : true;
	if (!isRec) return;

	const variantStr = String(flag.variant);
	span.setAttribute("feature_flag.key", flag.key);
	span.setAttribute("feature_flag.variant", variantStr);
	if (flag.providerName) {
		span.setAttribute("feature_flag.provider_name", flag.providerName);
	}
	if (flag.contextId) {
		span.setAttribute("feature_flag.context.id", flag.contextId);
	}
	span.setAttribute(`obs.feature_flags.${flag.key}`, flag.variant);

	if (emitEvent && typeof span.addEvent === "function") {
		span.addEvent("feature_flag.evaluation", {
			"feature_flag.key": flag.key,
			"feature_flag.variant": variantStr,
			...(flag.providerName
				? { "feature_flag.provider_name": flag.providerName }
				: {}),
			...(flag.contextId ? { "feature_flag.context.id": flag.contextId } : {}),
		});
	}
}

/** Stamps only the currently recorded feature flags on a span (no lineage). */
export function stampActiveFeatureFlags(span: Span): void {
	const isRec =
		typeof span.isRecording === "function" ? span.isRecording() : true;
	if (!isRec) return;
	for (const flag of getRecordedFeatureFlagEntries()) {
		applyFeatureFlagToOtelSpan(span, flag, false);
	}
}

/**
 * Stamps lineage attributes plus recorded feature flags on a span. Lineage is
 * normally carried by the resource; prefer `stampActiveFeatureFlags` per span.
 */
export function stampActiveFeatureFlagsAndLineage(
	span: Span,
	config?: LineageConfigInput,
): void {
	const isRec =
		typeof span.isRecording === "function" ? span.isRecording() : true;
	if (!isRec) return;

	const lineageAttrs = buildLineageAttributes(config);
	for (const [k, v] of Object.entries(lineageAttrs)) {
		span.setAttribute(k, v);
	}
	stampActiveFeatureFlags(span);
}

export function recordFeatureFlag(
	flagKey: string,
	variant: string | boolean | number,
	options?: RecordFeatureFlagOptions,
): void {
	const key = flagKey.trim();
	if (!key) return;

	const entry: RecordedFeatureFlag = {
		key,
		variant,
		...(options?.providerName ? { providerName: options.providerName } : {}),
		...(options?.contextId ? { contextId: options.contextId } : {}),
	};

	let store = featureFlagStorage.getStore();
	if (!store) {
		store = new Map<string, RecordedFeatureFlag>();
		featureFlagStorage.enterWith(store);
	}
	store.set(key, entry);

	const activeSpan = trace.getActiveSpan();
	if (activeSpan) {
		applyFeatureFlagToOtelSpan(activeSpan, entry, true);
	}
}

export function getRecordedFeatureFlags(): Record<
	string,
	string | boolean | number
> {
	const store = featureFlagStorage.getStore();
	if (!store || store.size === 0) return {};
	const out: Record<string, string | boolean | number> = {};
	for (const [k, v] of store.entries()) {
		out[k] = v.variant;
	}
	return out;
}

export function getRecordedFeatureFlagEntries(): RecordedFeatureFlag[] {
	const store = featureFlagStorage.getStore();
	if (!store || store.size === 0) return [];
	return Array.from(store.values());
}

export function clearRecordedFeatureFlags(): void {
	const store = featureFlagStorage.getStore();
	if (store) {
		store.clear();
	}
	featureFlagStorage.disable();
}

export function withFeatureFlagScope<T>(fn: () => T): T {
	const parentStore = featureFlagStorage.getStore();
	const scopedStore = new Map<string, RecordedFeatureFlag>(parentStore);
	return featureFlagStorage.run(scopedStore, fn);
}
