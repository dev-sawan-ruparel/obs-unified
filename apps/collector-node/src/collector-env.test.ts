import { getConfiguredRetentionHours } from "@obsunified/types/constants";
import { describe, expect, it } from "vitest";
import { resolveBlobStore } from "./collector-env";

describe("resolveBlobStore", () => {
	it("accepts file / s3 case-insensitively and defaults to file", () => {
		expect(resolveBlobStore(undefined)).toBe("file");
		expect(resolveBlobStore("")).toBe("file");
		expect(resolveBlobStore("file")).toBe("file");
		expect(resolveBlobStore("s3")).toBe("s3");
		expect(resolveBlobStore("S3")).toBe("s3");
		expect(resolveBlobStore(" S3 ")).toBe("s3");
	});

	it("refuses unknown values instead of silently using the filesystem", () => {
		expect(() => resolveBlobStore("minio")).toThrow(/BLOB_STORE="minio"/);
		expect(() => resolveBlobStore("s-3")).toThrow(/expected "file" or "s3"/);
	});
});

import {
	OPTIONAL_COLLECTOR_ENV_KEYS,
	readOptionalCollectorEnv,
} from "./collector-env";

describe("readOptionalCollectorEnv", () => {
	it("returns no keys and no warnings when nothing is set", () => {
		expect(readOptionalCollectorEnv({})).toEqual({ env: {}, warnings: [] });
	});

	it("forwards every optional CollectorEnv field verbatim (trimmed)", () => {
		const { env, warnings } = readOptionalCollectorEnv({
			RETENTION_HOURS: " 24 ",
			ANTHROPIC_API_KEY: "sk-ant-test",
			OPENAI_BASE_URL: "http://localhost:11434/v1 ",
			NARRATIVE_MODEL: "claude-haiku-4-5",
			NARRATIVE_BUDGET_PER_HOUR: "10",
			// Unrelated process env must not leak into the collector env.
			PATH: "/usr/bin",
			DATABASE_URL: "postgres://x",
		});
		expect(env).toEqual({
			RETENTION_HOURS: "24",
			ANTHROPIC_API_KEY: "sk-ant-test",
			OPENAI_BASE_URL: "http://localhost:11434/v1",
			NARRATIVE_MODEL: "claude-haiku-4-5",
			NARRATIVE_BUDGET_PER_HOUR: "10",
		});
		expect(
			Object.keys(env).every((k) =>
				(OPTIONAL_COLLECTOR_ENV_KEYS as readonly string[]).includes(k),
			),
		).toBe(true);
		// A model/base-url with an Anthropic key is a valid configuration.
		expect(warnings).toEqual([]);
	});

	it("treats blank values as unset so an empty OPENAI_API_KEY= does not shadow Anthropic", () => {
		const { env } = readOptionalCollectorEnv({
			OPENAI_API_KEY: "",
			OPENAI_BASE_URL: "   ",
			ANTHROPIC_API_KEY: "sk-ant-test",
			RETENTION_HOURS: "",
		});
		expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-ant-test" });
		expect("OPENAI_API_KEY" in env).toBe(false);
		expect("RETENTION_HOURS" in env).toBe(false);
	});

	it("forwards RETENTION_HOURS in the form the collector's parser expects", () => {
		const { env } = readOptionalCollectorEnv({ RETENTION_HOURS: "24" });
		expect(getConfiguredRetentionHours(env.RETENTION_HOURS)).toBe(24);
		// Absent → collector default (72h), identical to the Worker without the var.
		expect(
			getConfiguredRetentionHours(
				readOptionalCollectorEnv({}).env.RETENTION_HOURS,
			),
		).toBe(getConfiguredRetentionHours(undefined));
	});

	it("warns about values the collector will silently ignore", () => {
		const { env, warnings } = readOptionalCollectorEnv({
			RETENTION_HOURS: "three days",
			NARRATIVE_BUDGET_PER_HOUR: "-1",
		});
		// Still forwarded verbatim — the collector applies its own fallback —
		// but the operator is told at startup.
		expect(env).toEqual({
			RETENTION_HOURS: "three days",
			NARRATIVE_BUDGET_PER_HOUR: "-1",
		});
		expect(getConfiguredRetentionHours(env.RETENTION_HOURS)).toBe(
			getConfiguredRetentionHours(undefined),
		);
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toMatch(/RETENTION_HOURS="three days"/);
		expect(warnings[1]).toMatch(/NARRATIVE_BUDGET_PER_HOUR="-1"/);
	});

	it("flags provider ambiguity and orphaned narrative settings", () => {
		expect(
			readOptionalCollectorEnv({
				OPENAI_API_KEY: "sk-a",
				ANTHROPIC_API_KEY: "sk-b",
			}).warnings,
		).toEqual([
			"both OPENAI_API_KEY and ANTHROPIC_API_KEY are set; OpenAI is used for narratives",
		]);
		expect(
			readOptionalCollectorEnv({ NARRATIVE_MODEL: "gpt-4o-mini" }).warnings[0],
		).toMatch(/narratives stay disabled/);
	});
});
