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

export type {
	LineageConfigInput,
	ObservabilityLineageConfig,
	RecordedFeatureFlag,
	RecordFeatureFlagOptions,
};

let configuredLineage: ObservabilityLineageConfig | undefined;

const defaultEnv = (): LineageEnv => {
	const g = globalThis as { process?: { env?: LineageEnv } };
	return g.process?.env ?? {};
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

const recordedFlags = new Map<string, RecordedFeatureFlag>();
let lastRecordedFlag: RecordedFeatureFlag | undefined;

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
	recordedFlags.set(key, entry);
	lastRecordedFlag = entry;
}

export function getRecordedFeatureFlags(): Record<
	string,
	string | boolean | number
> {
	const out: Record<string, string | boolean | number> = {};
	for (const [k, v] of recordedFlags.entries()) {
		out[k] = v.variant;
	}
	return out;
}

export function getRecordedFeatureFlagEntries(): RecordedFeatureFlag[] {
	return Array.from(recordedFlags.values());
}

export function buildFeatureFlagAttributes(): Record<string, unknown> {
	if (recordedFlags.size === 0) return {};
	const attrs: Record<string, unknown> = {};
	for (const [key, entry] of recordedFlags.entries()) {
		attrs[`obs.feature_flags.${key}`] = entry.variant;
	}
	if (lastRecordedFlag) {
		attrs["feature_flag.key"] = lastRecordedFlag.key;
		attrs["feature_flag.variant"] = String(lastRecordedFlag.variant);
		if (lastRecordedFlag.providerName) {
			attrs["feature_flag.provider_name"] = lastRecordedFlag.providerName;
		}
		if (lastRecordedFlag.contextId) {
			attrs["feature_flag.context.id"] = lastRecordedFlag.contextId;
		}
	}
	return attrs;
}

export function clearRecordedFeatureFlags(): void {
	recordedFlags.clear();
	lastRecordedFlag = undefined;
}
