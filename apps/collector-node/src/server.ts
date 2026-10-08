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
	createDashboardAuth,
	createDefaultCollectorApp,
	createIngestAuth,
	PostgresAdapter,
	S3BlobStore,
} from "@obsunified/collector";
import { Pool } from "pg";
import { FileBlobStore } from "./file-blob-store";

const env = readEnv();

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

// INGEST_KEY is consumed by the auth layer via env-bootstrap; we
// expose it on `process.env` so the middleware's lazy lookup finds it.
process.env.INGEST_KEY = env.INGEST_KEY;

const ingestAuth = createIngestAuth({
	allowUnauthenticated: false,
});
const dashboardAuth = createDashboardAuth({
	password: env.DASHBOARD_PASSWORD,
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

const requestEnv: CollectorEnv = {
	DB: sqlDb as unknown as D1Database,
	REPLAYS_BUCKET: wrappedS3,
	PROFILES_BUCKET: wrappedS3,
	INGEST_KEY: env.INGEST_KEY,
	DASHBOARD_PASSWORD: env.DASHBOARD_PASSWORD,
	ALLOWED_ORIGINS: env.ALLOWED_ORIGINS.join(","),
};

const port = env.PORT;
const server = serve(
	{
		fetch: (request) => app.fetch(request, requestEnv),
		port,
	},
	({ port }) => {
		console.log(
			`[obs-unified] collector listening on http://0.0.0.0:${port}` +
				` (postgres + ${env.BLOB_STORE === "file" ? `file://${env.BLOB_DIR}` : `${env.S3_ENDPOINT ?? "s3"}/${env.S3_BUCKET}`})`,
		);
	},
);

const shutdown = async (signal: string) => {
	console.log(`[obs-unified] received ${signal}, draining…`);
	await closeServerWithDeadline(10_000);
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
	const blobStore = process.env.BLOB_STORE === "s3" ? "s3" : "file";
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
		ALLOWED_ORIGINS:
			process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()) ?? [],
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
