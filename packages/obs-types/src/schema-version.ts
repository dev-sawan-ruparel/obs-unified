/**
 * Wire-format schema version.
 *
 * Every SDK MUST send the `obs-schema-version` header on every ingest
 * call. The collector reads it on intake; mismatch responds with
 * HTTP 400 and a JSON body explaining the version skew.
 *
 * Bumping rules:
 *   - PATCH increments (1.0.0 → 1.0.1) for additive fields only.
 *     Old SDKs continue to work; the collector ignores extra fields.
 *   - MINOR increments (1.0 → 1.1) for new endpoints or new optional
 *     fields. Old SDKs continue to work.
 *   - MAJOR increments (1.x → 2.0) for breaking changes (renamed
 *     header, removed field, changed semantics). The collector
 *     accepts both versions during a transition window documented in
 *     the spec.
 *
 * Today's collector accepts only `1.x.y` — anything earlier or 2+
 * receives HTTP 400.
 */

export const SCHEMA_VERSION = "1.0.0" as const;
export const SCHEMA_VERSION_HEADER = "obs-schema-version" as const;

/**
 * Returns true when the collector should accept `version`. Used by
 * receivers on intake.
 */
export const isCompatibleSchemaVersion = (version: string | undefined | null): boolean => {
	if (!version) return true; // absent = legacy SDK, accept (deprecate in 2.0)
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!m) return false;
	const major = Number(m[1]);
	return major === 1;
};
