#!/usr/bin/env node
/**
 * Workstream 4 (RFC 0014) — Mandatory native-engine database migration and
 * query parity gate (`pnpm --filter @obsunified/collector check:db-parity`).
 *
 * When `OBS_PG_TEST_URL` is set, uses that empty scratch Postgres database.
 * When `OBS_PG_TEST_URL` is unset, starts a disposable `postgres:15` container
 * on an ephemeral localhost port, waits for readiness, runs the migration and
 * Postgres parity suites with `OBS_REQUIRE_PG_PARITY=1`, and removes the
 * container on exit.
 *
 * Fails with a non-zero exit code if neither `OBS_PG_TEST_URL` nor a reachable
 * Docker daemon is available — never silently skips.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(scriptDir, "..");

const env = { ...process.env };
const colimaSock = path.join(
	os.homedir(),
	".colima/obs-unified-smoke/docker.sock",
);

if (!env.DOCKER_HOST && existsSync(colimaSock)) {
	env.DOCKER_HOST = `unix://${colimaSock}`;
}

function isDockerReachable() {
	try {
		execFileSync("docker", ["info"], {
			env,
			stdio: "ignore",
			timeout: 5_000,
		});
		return true;
	} catch {
		return false;
	}
}

async function waitForPostgres(connectionString, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	let lastError = null;
	while (Date.now() < deadline) {
		const client = new pg.Client({ connectionString });
		try {
			await client.connect();
			const res = await client.query("SHOW server_version");
			const version = res.rows[0]?.server_version ?? "unknown";
			await client.end();
			return version;
		} catch (err) {
			lastError = err;
			await client.end().catch(() => {});
			await new Promise((r) => setTimeout(r, 250));
		}
	}
	throw new Error(
		`Postgres did not become ready at ${connectionString}: ${lastError?.message ?? "timeout"}`,
	);
}

let containerId = null;

try {
	if (!env.OBS_PG_TEST_URL) {
		if (!isDockerReachable()) {
			console.error(
				"[check:db-parity] ERROR: OBS_PG_TEST_URL is unset and Docker daemon is not reachable.",
			);
			console.error(
				"Start Docker / Colima (`colima start obs-unified-smoke`) or set OBS_PG_TEST_URL to an empty scratch Postgres database.",
			);
			process.exit(1);
		}

		console.log(
			"[check:db-parity] Starting disposable postgres:15 container...",
		);
		containerId = execFileSync(
			"docker",
			[
				"run",
				"-d",
				"--rm",
				"-e",
				"POSTGRES_USER=obs",
				"-e",
				"POSTGRES_PASSWORD=obs",
				"-e",
				"POSTGRES_DB=obs_parity_scratch",
				"-p",
				"127.0.0.1::5432",
				"postgres:15",
			],
			{ env, encoding: "utf8" },
		).trim();

		const portMapping = execFileSync(
			"docker",
			["port", containerId, "5432/tcp"],
			{ env, encoding: "utf8" },
		).trim();
		const hostPort = portMapping.split(":").pop()?.trim();
		if (!hostPort) {
			throw new Error(
				`Failed to resolve ephemeral port for container ${containerId}: ${portMapping}`,
			);
		}
		env.OBS_PG_TEST_URL = `postgres://obs:obs@127.0.0.1:${hostPort}/obs_parity_scratch`;
	}

	const pgVersion = await waitForPostgres(env.OBS_PG_TEST_URL);
	console.log(
		`[check:db-parity] Connected to PostgreSQL ${pgVersion} (Node ${process.version})`,
	);

	env.OBS_REQUIRE_PG_PARITY = "1";

	const result = spawnSync(
		"pnpm",
		[
			"exec",
			"vitest",
			"run",
			"src/migrations/parity.test.ts",
			"src/__tests__/db-parity.integration.test.ts",
			"src/lib/sql-db-postgres.integration.test.ts",
		],
		{
			cwd: pkgRoot,
			env,
			stdio: "inherit",
		},
	);

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
} finally {
	if (containerId) {
		try {
			execFileSync("docker", ["rm", "-f", containerId], {
				env,
				stdio: "ignore",
			});
		} catch {
			// Ignore container cleanup failures
		}
	}
}
