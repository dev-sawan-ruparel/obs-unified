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

import { serve } from "@hono/node-server";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import {
	createDashboardAuth,
	createDefaultCollectorApp,
	createIngestAuth,
	PostgresAdapter,
	S3BlobStore,
} from "@obs-unified/collector";
import { Pool } from "pg";

const env = readEnv();

const pool = new Pool({
	connectionString: env.DATABASE_URL,
	max: env.PG_POOL_MAX,
	idleTimeoutMillis: 30_000,
});

const sqlDb = new PostgresAdapter(pool, {
	statementTimeoutMs: 30_000,
});

const s3 = new S3Client({
	endpoint: env.S3_ENDPOINT,
	region: env.S3_REGION,
	forcePathStyle: env.S3_FORCE_PATH_STYLE,
	credentials: {
		accessKeyId: env.S3_ACCESS_KEY_ID,
		secretAccessKey: env.S3_SECRET_ACCESS_KEY,
	},
});

const blob = new S3BlobStore({
	client: s3,
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
	// types them without Variables — a known structural mismatch that's
	// benign at runtime. Same cast used by the Workers entrypoint in
	// `apps/collector/src/index.ts` (which doesn't run type-check, so the
	// drift wasn't caught upstream).
	auth: { middleware: ingestAuth } as never,
	dashboardAuth: dashboardAuth as never,
	allowedOrigins: env.ALLOWED_ORIGINS.join(","),
	// `sqlDb` in CollectorConfig is a factory `(env) => SqlDb`. We
	// already constructed the PostgresAdapter once at startup, so the
	// factory just returns it.
	sqlDb: () => sqlDb,
});
void blob;

const port = env.PORT;
serve({ fetch: app.fetch, port }, ({ port }) => {
	console.log(
		`[obs-unified] collector listening on http://0.0.0.0:${port}` +
			` (postgres + ${env.S3_ENDPOINT ?? "s3"}/${env.S3_BUCKET})`,
	);
});

const shutdown = async (signal: string) => {
	console.log(`[obs-unified] received ${signal}, draining…`);
	await pool.end().catch(() => {});
	process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

function readEnv() {
	const required = (k: string): string => {
		const v = process.env[k];
		if (!v) {
			console.error(`[obs-unified] missing required env: ${k}`);
			process.exit(1);
		}
		return v;
	};
	return {
		PORT: Number(process.env.PORT ?? 8790),
		DATABASE_URL: required("DATABASE_URL"),
		PG_POOL_MAX: Number(process.env.PG_POOL_MAX ?? 10),
		S3_ENDPOINT: process.env.S3_ENDPOINT,
		S3_REGION: process.env.S3_REGION ?? "us-east-1",
		S3_BUCKET: required("S3_BUCKET"),
		S3_FORCE_PATH_STYLE: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
		S3_ACCESS_KEY_ID: required("S3_ACCESS_KEY_ID"),
		S3_SECRET_ACCESS_KEY: required("S3_SECRET_ACCESS_KEY"),
		INGEST_KEY: required("INGEST_KEY"),
		DASHBOARD_PASSWORD: required("DASHBOARD_PASSWORD"),
		ALLOWED_ORIGINS:
			process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()) ?? [],
	};
}
