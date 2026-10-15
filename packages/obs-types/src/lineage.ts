/**
 * Shared runtime-lineage helpers (RFC 0013) used by the telemetry, analytics
 * and Node SDKs. Pure and environment-agnostic: callers pass `env` in, so this
 * module never touches `process` and is safe for browser bundles.
 */

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
	/** @deprecated Use the flat `environment` / `serviceVersion` / `commitSha` / `configDigest` fields instead. */
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

export type LineageEnv = Record<string, string | undefined>;

export const nonEmpty = (value: string | undefined): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

const ENVIRONMENT_ALIASES: Record<string, string> = {
	production: "prod",
	development: "dev",
};

/**
 * Canonicalises an environment name so SDK spans, change events and the
 * collector agree: lowercase + trim, `production` -> `prod`,
 * `development` -> `dev`, empty/undefined -> `default`. `test` is unchanged.
 */
export function normalizeEnvironment(raw: string | undefined): string {
	const value = (raw ?? "").trim().toLowerCase();
	if (!value) return "default";
	return ENVIRONMENT_ALIASES[value] ?? value;
}

/** Trims and flattens a (possibly nested-`lineage`) config; used to store configured lineage. */
export function normalizeLineageInput(
	config: LineageConfigInput,
): ObservabilityLineageConfig {
	return {
		environment: nonEmpty(config.environment ?? config.lineage?.environment),
		serviceVersion: nonEmpty(
			config.serviceVersion ?? config.lineage?.serviceVersion,
		),
		commitSha: nonEmpty(config.commitSha ?? config.lineage?.commitSha),
		configDigest: nonEmpty(config.configDigest ?? config.lineage?.configDigest),
	};
}

export function resolveLineageFromSources(
	config: LineageConfigInput | undefined,
	env: LineageEnv,
	configured?: ObservabilityLineageConfig,
): ObservabilityLineageConfig {
	const rawEnvironment =
		nonEmpty(config?.environment) ??
		nonEmpty(config?.lineage?.environment) ??
		nonEmpty(configured?.environment) ??
		nonEmpty(env.OBS_ENVIRONMENT) ??
		nonEmpty(env.NODE_ENV);
	const environment = rawEnvironment
		? normalizeEnvironment(rawEnvironment)
		: undefined;

	const serviceVersion =
		nonEmpty(config?.serviceVersion) ??
		nonEmpty(config?.lineage?.serviceVersion) ??
		nonEmpty(configured?.serviceVersion) ??
		nonEmpty(env.OBS_SERVICE_VERSION) ??
		nonEmpty(env.OTEL_SERVICE_VERSION);

	const commitSha =
		nonEmpty(config?.commitSha) ??
		nonEmpty(config?.lineage?.commitSha) ??
		nonEmpty(configured?.commitSha) ??
		nonEmpty(env.OBS_COMMIT_SHA) ??
		nonEmpty(env.GITHUB_SHA);

	const configDigest =
		nonEmpty(config?.configDigest) ??
		nonEmpty(config?.lineage?.configDigest) ??
		nonEmpty(configured?.configDigest) ??
		nonEmpty(env.OBS_CONFIG_DIGEST);

	return {
		...(environment ? { environment } : {}),
		...(serviceVersion ? { serviceVersion } : {}),
		...(commitSha ? { commitSha } : {}),
		...(configDigest ? { configDigest } : {}),
	};
}

export function lineageToAttributes(
	resolved: ObservabilityLineageConfig,
): Record<string, string> {
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

export function buildLineageAttributesFromSources(
	config: LineageConfigInput | undefined,
	env: LineageEnv,
	configured?: ObservabilityLineageConfig,
): Record<string, string> {
	return lineageToAttributes(
		resolveLineageFromSources(config, env, configured),
	);
}
