#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const composeFile = path.resolve(here, "../docker-compose.yml");
const projectName = process.env.COMPOSE_PROJECT_NAME ?? "obs-unified-smoke";
const baseUrl = process.env.COLLECTOR_SMOKE_URL ?? "http://127.0.0.1:8790";
const ingestKey = process.env.INGEST_KEY ?? "dev-ingest-key";
const dashboardPassword = process.env.DASHBOARD_PASSWORD ?? "e2e-test-pass";
const keepStack = process.argv.includes("--keep");

const composeArgs = ["compose", "-f", composeFile, "-p", projectName];
let failed = false;

await main();

async function main() {
	try {
		await ensureDockerAvailable();
		await docker([...composeArgs, "up", "-d", "--build"]);
		await waitForHealth();

		const cookie = await login();
		await smokeReplay(cookie);
		await smokeProfile(cookie);

		console.log("[smoke] collector docker smoke test passed");
	} catch (err) {
		failed = true;
		console.error("[smoke] failed:", err instanceof Error ? err.message : err);
		await docker(
			[
				...composeArgs,
				"logs",
				"--no-color",
				"collector",
				"migrate",
				"postgres",
				"minio",
			],
			{ allowFailure: true },
		);
		process.exitCode = 1;
	} finally {
		if (!keepStack) {
			await docker([...composeArgs, "down", "-v"], { allowFailure: failed });
		}
	}
}

async function ensureDockerAvailable() {
	await docker(["--version"], {
		allowFailure: false,
		errorMessage:
			"Docker is required for this smoke test. Install Docker Desktop or run from an environment with docker compose.",
	});
	await docker(["compose", "version"], {
		allowFailure: false,
		errorMessage:
			"docker compose is required for this smoke test. Install a Docker version with Compose v2.",
	});
}

async function waitForHealth() {
	const deadline = Date.now() + 120_000;
	let lastError = "collector did not respond";

	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${baseUrl}/health`);
			if (res.ok) {
				console.log("[smoke] collector health check passed");
				return;
			}
			lastError = `health returned ${res.status}`;
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
		}
		await sleep(2_000);
	}

	throw new Error(`collector health check timed out: ${lastError}`);
}

async function login() {
	const res = await fetch(`${baseUrl}/auth/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ password: dashboardPassword }),
	});
	await assertOk(res, "dashboard login");

	const cookie = res.headers.get("set-cookie")?.split(";")[0];
	if (!cookie)
		throw new Error("dashboard login did not return a session cookie");
	console.log("[smoke] dashboard login passed");
	return cookie;
}

async function smokeReplay(cookie) {
	const sessionId = `smoke-session-${Date.now()}`;
	const now = Date.now();
	const events = [
		{ type: 0, timestamp: now, data: {} },
		{ type: 1, timestamp: now + 1, data: {} },
		{ type: 2, timestamp: now + 2, data: {} },
	];

	const ingest = await fetch(`${baseUrl}/v1/replays`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${ingestKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			sessionId,
			visitorId: "smoke-visitor",
			sequenceNumber: 1,
			events,
		}),
	});
	await assertOk(ingest, "replay ingest");

	const readback = await fetch(
		`${baseUrl}/internal/replays/${encodeURIComponent(sessionId)}`,
		{
			headers: internalHeaders(cookie),
		},
	);
	await assertOk(readback, "replay readback");
	const body = await readback.json();
	if (!Array.isArray(body.events) || body.events.length !== events.length) {
		throw new Error(
			`expected ${events.length} replay events, got ${body.events?.length}`,
		);
	}
	console.log("[smoke] replay ingest/readback passed");
}

async function smokeProfile(cookie) {
	const traceId = "0123456789abcdef0123456789abcdef";
	const profileBytes = new TextEncoder().encode(
		"obs-unified smoke pprof bytes",
	);

	const ingest = await fetch(`${baseUrl}/v1/profiles/pprof`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${ingestKey}`,
			"x-obs-profile-type": "cpu",
			"x-obs-service": "smoke-service",
			"x-obs-trace-ids": traceId,
			"x-obs-duration-ms": "1000",
			"x-obs-agent": "docker-smoke",
		},
		body: profileBytes,
	});
	await assertOk(ingest, "profile ingest", [202]);
	const ingestBody = await ingest.json();
	const profileId = ingestBody.profileId;
	if (typeof profileId !== "string" || profileId.length === 0) {
		throw new Error("profile ingest did not return profileId");
	}

	const metadata = await fetch(
		`${baseUrl}/internal/profiles/${encodeURIComponent(profileId)}`,
		{ headers: internalHeaders(cookie) },
	);
	await assertOk(metadata, "profile metadata readback");
	const metadataBody = await metadata.json();
	if (!metadataBody.traceIds?.includes(traceId)) {
		throw new Error("profile metadata did not include indexed trace id");
	}

	const blob = await fetch(
		`${baseUrl}/internal/profiles/${encodeURIComponent(profileId)}?blob=true`,
		{ headers: internalHeaders(cookie) },
	);
	await assertOk(blob, "profile blob readback");
	const blobBytes = await blob.arrayBuffer();
	if (blobBytes.byteLength !== profileBytes.byteLength) {
		throw new Error(
			`expected profile blob ${profileBytes.byteLength} bytes, got ${blobBytes.byteLength}`,
		);
	}
	console.log("[smoke] profile ingest/metadata/blob readback passed");
}

function internalHeaders(cookie) {
	return {
		cookie,
		"x-project-id": "default",
	};
}

async function assertOk(res, label, expectedStatuses = [200]) {
	if (expectedStatuses.includes(res.status)) return;
	const text = await res.text().catch(() => "");
	throw new Error(`${label} returned ${res.status}: ${text.slice(0, 500)}`);
}

async function docker(args, options = {}) {
	const { allowFailure = false, errorMessage } = options;
	let code;
	try {
		code = await spawnCommand("docker", args);
	} catch (err) {
		if (allowFailure) return;
		if (err?.code === "ENOENT") {
			throw new Error(
				errorMessage ??
					"Docker is required for this smoke test, but the docker executable was not found.",
			);
		}
		throw err;
	}
	if (code === 0 || allowFailure) return;
	throw new Error(errorMessage ?? `docker ${args.join(" ")} exited ${code}`);
}

function spawnCommand(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.on("error", reject);
		child.on("exit", (code) => resolve(code ?? 1));
	});
}
