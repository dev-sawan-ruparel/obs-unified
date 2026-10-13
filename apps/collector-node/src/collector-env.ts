/**
 * Optional `CollectorEnv` fields the Node server forwards from the process
 * environment so HTTP handlers and the maintenance scheduler behave like the
 * Cloudflare Worker, which receives these as plain `env` vars:
 *
 *   RETENTION_HOURS            — row/blob retention window (default 72, see
 *                                `getConfiguredRetentionHours`)
 *   ANTHROPIC_API_KEY          — enables the analyses narrate pass + Ask box
 *   OPENAI_API_KEY             — same, via OpenAI-compatible chat completions
 *   OPENAI_BASE_URL            — override for OpenAI-compatible endpoints
 *   NARRATIVE_MODEL            — model id (provider-specific defaults)
 *   NARRATIVE_BUDGET_PER_HOUR  — cap on narrative writes per project per hour
 *
 * Blank values are coerced to `undefined`, mirroring the Worker-side
 * `.dev.vars` handling in the analyses runner, so an empty `OPENAI_API_KEY=`
 * line never shadows an Anthropic key or flips the Ask endpoint on.
 */

import type { CollectorEnv } from "@obsunified/collector";

export const OPTIONAL_COLLECTOR_ENV_KEYS = [
	"RETENTION_HOURS",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"OPENAI_BASE_URL",
	"NARRATIVE_MODEL",
	"NARRATIVE_BUDGET_PER_HOUR",
] as const satisfies readonly (keyof CollectorEnv)[];

export type BlobStoreKind = "file" | "s3";

/**
 * `BLOB_STORE` selects the blob backend. Values are case-insensitive and
 * trimmed; anything other than `file` / `s3` (or unset, which means `file`)
 * is an error rather than a silent fall back to the local filesystem, so a
 * typo like `S3 ` cannot route production replays onto a container disk.
 */
export function resolveBlobStore(raw: string | undefined): BlobStoreKind {
	const value = (raw ?? "").trim().toLowerCase();
	if (value === "" || value === "file") return "file";
	if (value === "s3") return "s3";
	throw new Error(
		`BLOB_STORE="${raw}" is not supported; expected "file" or "s3"`,
	);
}

export type OptionalCollectorEnvKey =
	(typeof OPTIONAL_COLLECTOR_ENV_KEYS)[number];

export type OptionalCollectorEnv = Pick<CollectorEnv, OptionalCollectorEnvKey>;

export interface OptionalCollectorEnvResult {
	/** Spread into the server's `requestEnv`. Only set keys are present. */
	env: OptionalCollectorEnv;
	/** Human-readable notes about values that will not take effect as given. */
	warnings: string[];
}

const isPositiveInteger = (raw: string): boolean =>
	/^\d+$/.test(raw) && Number(raw) >= 1;

/**
 * Reads the optional collector fields from `source` (defaults to `process.env`).
 * Never throws and never exits: every field is optional, and malformed
 * numeric values fall back to the collector's defaults at use time, so they
 * are reported as warnings for the startup log rather than treated as fatal.
 */
export function readOptionalCollectorEnv(
	source: Record<string, string | undefined> = process.env,
): OptionalCollectorEnvResult {
	const env: OptionalCollectorEnv = {};
	for (const key of OPTIONAL_COLLECTOR_ENV_KEYS) {
		const value = source[key]?.trim();
		if (value) env[key] = value;
	}

	const warnings: string[] = [];
	if (
		env.RETENTION_HOURS !== undefined &&
		!isPositiveInteger(env.RETENTION_HOURS)
	) {
		warnings.push(
			`RETENTION_HOURS="${env.RETENTION_HOURS}" is not a positive integer; the default retention window will be used`,
		);
	}
	if (
		env.NARRATIVE_BUDGET_PER_HOUR !== undefined &&
		!isPositiveInteger(env.NARRATIVE_BUDGET_PER_HOUR)
	) {
		warnings.push(
			`NARRATIVE_BUDGET_PER_HOUR="${env.NARRATIVE_BUDGET_PER_HOUR}" is not a positive integer; non-numeric values fall back to the default budget and values below 1 disable narratives`,
		);
	}
	if (env.OPENAI_API_KEY && env.ANTHROPIC_API_KEY) {
		warnings.push(
			"both OPENAI_API_KEY and ANTHROPIC_API_KEY are set; OpenAI is used for narratives",
		);
	}
	if (
		(env.OPENAI_BASE_URL || env.NARRATIVE_MODEL) &&
		!env.OPENAI_API_KEY &&
		!env.ANTHROPIC_API_KEY
	) {
		warnings.push(
			"OPENAI_BASE_URL / NARRATIVE_MODEL are set but no ANTHROPIC_API_KEY or OPENAI_API_KEY; narratives stay disabled",
		);
	}
	return { env, warnings };
}
