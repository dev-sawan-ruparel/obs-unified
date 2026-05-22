#!/usr/bin/env node
// Postgres migration runner. Mirrors the D1 runner in
// apps/collector/scripts/migrate.mjs but executes against a real
// Postgres database via the `pg` driver. Tracking table:
//
//   CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
//
// Re-running is safe — applied migrations are skipped.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(
	here,
	"../../../packages/obs-collector/src/migrations-postgres",
);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("DATABASE_URL not set");
	process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

await client.query(`
	CREATE TABLE IF NOT EXISTS schema_migrations (
		name TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)
`);

const applied = new Set(
	(await client.query("SELECT name FROM schema_migrations")).rows.map(
		(r) => r.name,
	),
);

const files = (await readdir(migrationsDir))
	.filter((f) => f.endsWith(".sql"))
	.sort();

let appliedCount = 0;
for (const file of files) {
	if (applied.has(file)) continue;
	const sql = await readFile(path.join(migrationsDir, file), "utf8");
	try {
		await client.query("BEGIN");
		await client.query(sql);
		await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
			file,
		]);
		await client.query("COMMIT");
		console.log(`[migrate] applied ${file}`);
		appliedCount += 1;
	} catch (err) {
		await client.query("ROLLBACK").catch(() => {});
		console.error(`[migrate] ${file} failed:`, err);
		process.exit(1);
	}
}

await client.end();
console.log(`[migrate] done (${appliedCount} new of ${files.length} total)`);
