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
import { trace } from "@opentelemetry/api";

export type {
	LineageConfigInput,
	ObservabilityLineageConfig,
	RecordedFeatureFlag,
	RecordFeatureFlagOptions,
};

export interface FeatureFlagSpanTarget {
	setAttribute(key: string, value: unknown): void;
	addEvent?(name: string, attributes?: Record<string, unknown>): void;
}

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
	return buildLineageAttributesFromSources(config, env, configuredLineage);
}

// ── Feature Flag Evaluation Recording (RFC 0013 § 2.A) ──────────────────────

const featureFlagStorage = new AsyncLocalStorage<
	Map<string, RecordedFeatureFlag>
>();

/**
 * Fallback store for runtimes (e.g. Cloudflare Workers) whose AsyncLocalStorage
 * lacks `enterWith` / `disable`. Only used when no ALS store is active.
 */
const fallbackFlagStore = new Map<string, RecordedFeatureFlag>();

const activeFlagStore = (): Map<string, RecordedFeatureFlag> | undefined =>
	featureFlagStorage.getStore() ??
	(fallbackFlagStore.size > 0 ? fallbackFlagStore : undefined);

let activeSpanGetter: (() => FeatureFlagSpanTarget | undefined) | null = null;
let activeChildSpanGetter: (() => FeatureFlagSpanTarget | undefined) | null =
	null;

export function registerSpanGetters(
	getRequestSpan: () => FeatureFlagSpanTarget | undefined,
	getChildSpan: () => FeatureFlagSpanTarget | undefined,
): void {
	activeSpanGetter = getRequestSpan;
	activeChildSpanGetter = getChildSpan;
}

export function applyFeatureFlagToSpan(
	target: FeatureFlagSpanTarget,
	flag: RecordedFeatureFlag,
	emitEvent = true,
): void {
	const variantStr = String(flag.variant);
	target.setAttribute("feature_flag.key", flag.key);
	target.setAttribute("feature_flag.variant", variantStr);
	if (flag.providerName) {
		target.setAttribute("feature_flag.provider_name", flag.providerName);
	}
	if (flag.contextId) {
		target.setAttribute("feature_flag.context.id", flag.contextId);
	}
	target.setAttribute(`obs.feature_flags.${flag.key}`, flag.variant);

	if (emitEvent && typeof target.addEvent === "function") {
		const eventAttrs: Record<string, unknown> = {
			"feature_flag.key": flag.key,
			"feature_flag.variant": variantStr,
		};
		if (flag.providerName) {
			eventAttrs["feature_flag.provider_name"] = flag.providerName;
		}
		if (flag.contextId) {
			eventAttrs["feature_flag.context.id"] = flag.contextId;
		}
		target.addEvent("feature_flag.evaluation", eventAttrs);
	}
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
		const fresh = new Map<string, RecordedFeatureFlag>();
		try {
			featureFlagStorage.enterWith(fresh);
		} catch {
			// enterWith unsupported; fall through to the module-level fallback.
		}
		store = featureFlagStorage.getStore() ?? fallbackFlagStore;
	}
	store.set(key, entry);

	const requestSpan = activeSpanGetter?.();
	if (requestSpan) {
		applyFeatureFlagToSpan(requestSpan, entry, true);
	}

	const childSpan = activeChildSpanGetter?.();
	if (childSpan && childSpan !== requestSpan) {
		applyFeatureFlagToSpan(childSpan, entry, true);
	}

	const otelSpan = trace.getActiveSpan();
	if (otelSpan?.isRecording()) {
		const variantStr = String(variant);
		otelSpan.setAttribute("feature_flag.key", key);
		otelSpan.setAttribute("feature_flag.variant", variantStr);
		if (options?.providerName) {
			otelSpan.setAttribute("feature_flag.provider_name", options.providerName);
		}
		if (options?.contextId) {
			otelSpan.setAttribute("feature_flag.context.id", options.contextId);
		}
		otelSpan.setAttribute(`obs.feature_flags.${key}`, variant);
		otelSpan.addEvent("feature_flag.evaluation", {
			"feature_flag.key": key,
			"feature_flag.variant": variantStr,
			...(options?.providerName
				? { "feature_flag.provider_name": options.providerName }
				: {}),
			...(options?.contextId
				? { "feature_flag.context.id": options.contextId }
				: {}),
		});
	}
}

export function getRecordedFeatureFlags(): Record<
	string,
	string | boolean | number
> {
	const store = activeFlagStore();
	if (!store || store.size === 0) return {};
	const out: Record<string, string | boolean | number> = {};
	for (const [k, v] of store.entries()) {
		out[k] = v.variant;
	}
	return out;
}

export function getRecordedFeatureFlagEntries(): RecordedFeatureFlag[] {
	const store = activeFlagStore();
	if (!store || store.size === 0) return [];
	return Array.from(store.values());
}

export function clearRecordedFeatureFlags(): void {
	featureFlagStorage.getStore()?.clear();
	fallbackFlagStore.clear();
}

export function withFeatureFlagScope<T>(fn: () => T): T {
	const parentStore = activeFlagStore();
	const scopedStore = new Map<string, RecordedFeatureFlag>(parentStore);
	return featureFlagStorage.run(scopedStore, fn);
}
