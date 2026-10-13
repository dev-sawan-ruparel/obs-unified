/**
 * Request body limits for ingest (`/v1/*`) and admin (`/internal/*`) routes.
 *
 * Without a cap the collector buffered whole bodies (and fully gunzipped
 * OTLP payloads) before the per-item caps applied. Cloudflare bounds the raw
 * request size per plan; the Node host has no platform limit, so a single
 * ingest key could exhaust memory with one request or one gzip bomb.
 */

/** Raw request body cap. Overridable via `MAX_BODY_BYTES` or `CollectorConfig.maxBodyBytes`. */
export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Cap on the gunzipped OTLP payload (a 10 MiB gzip can expand far beyond this). */
export const DEFAULT_MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024;

export const parseByteLimit = (
	raw: string | undefined,
	fallback: number,
): number => {
	const parsed = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
