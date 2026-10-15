export interface ObservabilityLineageConfig {
	/** Deployment environment, e.g. "prod", "staging", "preview". Default: OBS_ENVIRONMENT || NODE_ENV || "default" */
	environment?: string;
	/** Service or app release version, e.g. "2.4.1". Default: OBS_SERVICE_VERSION */
	serviceVersion?: string;
	/** Immutable Git commit SHA, e.g. "8f3a1b2". Default: OBS_COMMIT_SHA || GITHUB_SHA */
	commitSha?: string;
	/** Digest or version of runtime config, e.g. "cfg_99a1". Default: OBS_CONFIG_DIGEST */
	configDigest?: string;
}

export type LineageConfigInput = ObservabilityLineageConfig & {
	lineage?: ObservabilityLineageConfig;
};

export interface RecordFeatureFlagOptions {
	providerName?: string;
	contextId?: string;
}

export interface RecordedFeatureFlag {
	key: string;
	variant: string | boolean | number;
	providerName?: string;
	contextId?: string;
}

const defaultEnv = (): Record<string, string | undefined> => {
	const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
	return g.process?.env ?? {};
};

const nonEmpty = (value: string | undefined): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

let configuredLineage: ObservabilityLineageConfig | undefined;

export function setConfiguredLineage(config?: LineageConfigInput): void {
	if (!config) {
		configuredLineage = undefined;
		return;
	}
	configuredLineage = {
		environment: nonEmpty(config.environment ?? config.lineage?.environment),
		serviceVersion: nonEmpty(
			config.serviceVersion ?? config.lineage?.serviceVersion,
		),
		commitSha: nonEmpty(config.commitSha ?? config.lineage?.commitSha),
		configDigest: nonEmpty(config.configDigest ?? config.lineage?.configDigest),
	};
}

export function getConfiguredLineage(): ObservabilityLineageConfig | undefined {
	return configuredLineage ? { ...configuredLineage } : undefined;
}

export function resolveLineageConfig(
	config?: LineageConfigInput,
	env: Record<string, string | undefined> = defaultEnv(),
): ObservabilityLineageConfig {
	const environment =
		nonEmpty(config?.environment) ??
		nonEmpty(config?.lineage?.environment) ??
		nonEmpty(configuredLineage?.environment) ??
		nonEmpty(env.OBS_ENVIRONMENT) ??
		nonEmpty(env.NODE_ENV);

	const serviceVersion =
		nonEmpty(config?.serviceVersion) ??
		nonEmpty(config?.lineage?.serviceVersion) ??
		nonEmpty(configuredLineage?.serviceVersion) ??
		nonEmpty(env.OBS_SERVICE_VERSION);

	const commitSha =
		nonEmpty(config?.commitSha) ??
		nonEmpty(config?.lineage?.commitSha) ??
		nonEmpty(configuredLineage?.commitSha) ??
		nonEmpty(env.OBS_COMMIT_SHA) ??
		nonEmpty(env.GITHUB_SHA);

	const configDigest =
		nonEmpty(config?.configDigest) ??
		nonEmpty(config?.lineage?.configDigest) ??
		nonEmpty(configuredLineage?.configDigest) ??
		nonEmpty(env.OBS_CONFIG_DIGEST);

	return {
		...(environment ? { environment } : {}),
		...(serviceVersion ? { serviceVersion } : {}),
		...(commitSha ? { commitSha } : {}),
		...(configDigest ? { configDigest } : {}),
	};
}

export function buildLineageAttributes(
	config?: LineageConfigInput,
	env: Record<string, string | undefined> = defaultEnv(),
): Record<string, string> {
	const resolved = resolveLineageConfig(config, env);
	const attributes: Record<string, string> = {};

	if (resolved.environment) {
		attributes["deployment.environment.name"] = resolved.environment;
		attributes["obs.environment"] = resolved.environment;
	}
	if (resolved.serviceVersion) {
		attributes["service.version"] = resolved.serviceVersion;
		attributes["obs.service.version"] = resolved.serviceVersion;
	}
	if (resolved.commitSha) {
		attributes["vcs.commit.id"] = resolved.commitSha;
		attributes["obs.commit.sha"] = resolved.commitSha;
	}
	if (resolved.configDigest) {
		attributes["obs.config.digest"] = resolved.configDigest;
	}

	return attributes;
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
