/**
 * Standalone Node.js entrypoint for the obs-unified collector.
 *
 * Backs the collector runtime with:
 *   - Postgres (via `pg`) for SQL storage.
 *   - Any S3-compatible blob store (via `@aws-sdk/client-s3`) for replay
 *     and pprof payloads. Works with MinIO out of the box for local
 *     development.
 *
 * Configure via environment variables — see README.md.
 */

import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { serve } from "@hono/node-server";
import {
	BlobStoreToR2Adapter,
	type CollectorEnv,
	configurePostgresTypeParsers,
	createDashboardAuth,
	createDefaultCollectorApp,
	createIngestAuth,
	PostgresAdapter,
	S3BlobStore,
} from "@obsunified/collector";
import pg, { Pool } from "pg";
import {
	type BlobStoreKind,
	readOptionalCollectorEnv,
	resolveBlobStore,
} from "./collector-env.ts";
import { FileBlobStore } from "./file-blob-store.ts";
import {
	createCollectorMaintenance,
	readMaintenanceConfig,
} from "./maintenance.ts";
import { createNodeFetch, loginClientAddress } from "./node-host.ts";

const env = readEnv();

// The shared stores were written against D1 result shapes: INTEGER 0/1
// flags, numeric aggregates, JSON columns as text. Teach `pg` to return
// BOOLEAN / BIGINT / NUMERIC / JSON(B) the same way before any query runs.
configurePostgresTypeParsers(pg.types);

const pool = new Pool({
	connectionString: env.DATABASE_URL,
	max: env.PG_POOL_MAX,
	idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
	console.error("[obs-unified] pg.Pool idle client connection error:", err);
});

const sqlDb = new PostgresAdapter(pool, {
	statementTimeoutMs: 30_000,
});

const blob =
	env.BLOB_STORE === "file"
		? new FileBlobStore({ root: env.BLOB_DIR })
		: new S3BlobStore({
				client: new S3Client({
					endpoint: env.S3_ENDPOINT,
					region: env.S3_REGION,
					forcePathStyle: env.S3_FORCE_PATH_STYLE,
					credentials: {
						accessKeyId: env.S3_ACCESS_KEY_ID,
						secretAccessKey: env.S3_SECRET_ACCESS_KEY,
					},
				}),
				commands: {
					PutObjectCommand,
					GetObjectCommand,
					DeleteObjectCommand,
					ListObjectsV2Command,
				},
				bucket: env.S3_BUCKET,
			});

// INGEST_KEY reaches the auth layer through `requestEnv` below (the
// middleware bootstraps from `c.env.INGEST_KEY`); nothing reads it from
// `process.env`, so the global environment is left untouched.

const ingestAuth = createIngestAuth({
	allowUnauthenticated: false,
});
const dashboardAuth = createDashboardAuth({
	password: env.DASHBOARD_PASSWORD,
	token: env.DASHBOARD_TOKEN,
	loginRateLimit: {
		// The TCP peer is the only identity a direct client cannot choose.
		// Behind a reverse proxy that peer is the proxy itself, so operators
		// set TRUST_PROXY=true to key on the forwarded client address instead.
		// Resolving the peer needs the Node adapter bindings forwarded by
		// `createNodeFetch` below.
		clientAddress: loginClientAddress,
		trustProxyHeaders: env.TRUST_PROXY,
	},
});

const app = createDefaultCollectorApp({
	// `auth` and `dashboardAuth` middlewares are declared with
	// `Variables: { projectId: string }`. The framework's CollectorConfig
	// types them with Variables: any — ensuring full type-safety.
	auth: { middleware: ingestAuth },
	dashboardAuth: dashboardAuth,
	allowedOrigins: env.ALLOWED_ORIGINS.join(","),
	// `sqlDb` in CollectorConfig is a factory `(env) => SqlDb`. We
	// already constructed the PostgresAdapter once at startup, so the
	// factory just returns it.
	sqlDb: () => sqlDb,
});
const wrappedS3 = new BlobStoreToR2Adapter(blob);

// Optional Worker-parity fields (RETENTION_HOURS, narrative LLM settings).
// Forwarded into the same env object HTTP handlers and the maintenance
// scheduler receive, so retention windows and the analyses narrate pass
// behave exactly as they do on Cloudflare.
const optionalEnv = readOptionalCollectorEnv(process.env);
for (const warning of optionalEnv.warnings) {
	console.warn(`[obs-unified] ${warning}`);
}

const requestEnv: CollectorEnv = {
	DB: sqlDb as unknown as D1Database,
	REPLAYS_BUCKET: wrappedS3,
	PROFILES_BUCKET: wrappedS3,
	INGEST_KEY: env.INGEST_KEY,
	DASHBOARD_PASSWORD: env.DASHBOARD_PASSWORD,
	DASHBOARD_TOKEN: env.DASHBOARD_TOKEN,
	ALLOWED_ORIGINS: env.ALLOWED_ORIGINS.join(","),
	...optionalEnv.env,
};

const port = env.PORT;
const server = serve(
	{
		// Forward the adapter's `{ incoming, outgoing }` bindings together with
		// `requestEnv`; `getConnInfo` needs them to read the TCP peer.
		fetch: createNodeFetch(app, requestEnv),
		port,
	},
	({ port }) => {
		console.log(
			`[obs-unified] collector listening on http://0.0.0.0:${port}` +
				` (postgres + ${env.BLOB_STORE === "file" ? `file://${env.BLOB_DIR}` : `${env.S3_ENDPOINT ?? "s3"}/${env.S3_BUCKET}`})`,
		);
	},
);

// Background maintenance — the Node counterpart of the Worker's cron
// triggers: due analyses every minute, alert evaluation every five minutes,
// retention cleanup hourly. Runs against the same `requestEnv` (and therefore
// the same PostgresAdapter + blob store) as HTTP traffic. Disable with
// MAINTENANCE_ENABLED=false when an external scheduler owns these jobs or
// when running several replicas and only one should do maintenance.
const maintenanceConfig = readMaintenanceConfig();
const maintenance = createCollectorMaintenance({
	env: requestEnv,
	config: maintenanceConfig,
});
if (maintenanceConfig.enabled) {
	maintenance.start();
} else {
	console.log(
		"[obs-unified] maintenance scheduler disabled (MAINTENANCE_ENABLED=false)",
	);
}

let shuttingDown = false;
const shutdown = async (signal: string) => {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[obs-unified] received ${signal}, draining…`);
	// Stop scheduling new maintenance ticks and close the listener together;
	// both wait for in-flight work up to the deadline before the pool goes.
	const [, drain] = await Promise.all([
		closeServerWithDeadline(10_000),
		maintenance.stop({ drainTimeoutMs: 10_000 }),
	]);
	if (!drain.drained) {
		console.warn(
			`[obs-unified] maintenance tasks still running at shutdown deadline: ${drain.inFlight.join(", ")}`,
		);
	}
	await pool.end().catch(() => {});
	process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

function closeServerWithDeadline(timeoutMs: number): Promise<void> {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => resolve(), timeoutMs);
		if (typeof timeout.unref === "function") timeout.unref();
		server.close(() => {
			clearTimeout(timeout);
			resolve();
		});
	});
}

function readEnv() {
	const required = (k: string): string => {
		const v = process.env[k];
		if (!v) {
			console.error(`[obs-unified] missing required env: ${k}`);
			process.exit(1);
		}
		return v;
	};
	let blobStore: BlobStoreKind;
	try {
		blobStore = resolveBlobStore(process.env.BLOB_STORE);
	} catch (err) {
		console.error(
			`[obs-unified] ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	}
	return {
		PORT: readNumberEnv("PORT", 8790),
		DATABASE_URL: required("DATABASE_URL"),
		PG_POOL_MAX: readNumberEnv("PG_POOL_MAX", 10),
		BLOB_STORE: blobStore,
		BLOB_DIR: process.env.BLOB_DIR ?? "/tmp/obs-unified-blobs",
		S3_ENDPOINT: process.env.S3_ENDPOINT,
		S3_REGION: process.env.S3_REGION || "us-east-1",
		S3_BUCKET:
			blobStore === "s3"
				? required("S3_BUCKET")
				: (process.env.S3_BUCKET ?? "obs-local-blobs"),
		S3_FORCE_PATH_STYLE: readBooleanEnv("S3_FORCE_PATH_STYLE", true),
		S3_ACCESS_KEY_ID:
			blobStore === "s3"
				? required("S3_ACCESS_KEY_ID")
				: (process.env.S3_ACCESS_KEY_ID ?? "local"),
		S3_SECRET_ACCESS_KEY:
			blobStore === "s3"
				? required("S3_SECRET_ACCESS_KEY")
				: (process.env.S3_SECRET_ACCESS_KEY ?? "local"),
		INGEST_KEY: required("INGEST_KEY"),
		DASHBOARD_PASSWORD: required("DASHBOARD_PASSWORD"),
		DASHBOARD_TOKEN:
			process.env.DASHBOARD_TOKEN?.trim() ||
			process.env.OBS_DASHBOARD_TOKEN?.trim() ||
			undefined,
		ALLOWED_ORIGINS:
			process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()) ?? [],
		TRUST_PROXY: readBooleanEnv("TRUST_PROXY", false),
	};
}

function readNumberEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	return raw === "true";
}
