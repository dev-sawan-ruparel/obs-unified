import { AsyncLocalStorage } from "node:async_hooks";
import { type Span, trace } from "@opentelemetry/api";

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

let configuredLineage: ObservabilityLineageConfig | undefined;

const defaultEnv = (): Record<string, string | undefined> => {
	if (typeof process !== "undefined" && process?.env) {
		return process.env;
	}
	return {};
};

const nonEmpty = (value: string | undefined): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

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
		nonEmpty(env.OBS_SERVICE_VERSION) ??
		nonEmpty(env.OTEL_SERVICE_VERSION);

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
		attributes["deployment.environment"] = resolved.environment;
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
	for (const flag of getRecordedFeatureFlagEntries()) {
		applyFeatureFlagToOtelSpan(span, flag, false);
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
