#!/usr/bin/env node
/**
 * Versioned D1 migration runner.
 *
 * Replaces the flat `wrangler d1 execute --file=...` chain that used to live in
 * package.json. Two problems with that:
 *   1. Re-running on an already-migrated DB blew up on `ALTER TABLE ADD COLUMN`
 *      because SQLite/D1 has no `IF NOT EXISTS` for ALTER.
 *   2. Partial-state recovery required hand-editing the chain.
 *
 * This runner keeps a `schema_migrations` table and only applies files that
 * aren't already recorded. For existing DBs that ran the old chain, it
 * auto-backfills the table on first run by treating "duplicate column" /
 * "already exists" errors as "this migration is already applied".
 *
 * Usage:
 *   node scripts/migrate.mjs --local         # default
 *   node scripts/migrate.mjs --remote        # production D1
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(
	__dirname,
	"../../../packages/obs-collector/src/migrations",
);
const DB_NAME = "obs-collector-db";

const args = process.argv.slice(2);
const target = args.includes("--remote") ? "--remote" : "--local";

const TRACKING_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`.trim();

// `wrangler d1 execute --json` writes structured output to stdout. We capture
// stderr separately so we can surface useful errors without parsing the
// JSON line by line.
function wrangler({ command, file, captureJson = false }) {
	const argv = ["wrangler", "d1", "execute", DB_NAME, target];
	if (captureJson) argv.push("--json");
	if (command) argv.push("--command", command);
	if (file) argv.push("--file", file);
	try {
		const stdout = execFileSync("npx", argv, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { ok: true, stdout };
	} catch (err) {
		return {
			ok: false,
			stdout: err.stdout?.toString() ?? "",
			stderr: err.stderr?.toString() ?? "",
			message: err.message,
		};
	}
}

function listApplied() {
	const res = wrangler({
		command: "SELECT name FROM schema_migrations;",
		captureJson: true,
	});
	if (!res.ok) {
		// First-time bootstrap: the SELECT will fail before the table exists.
		return null;
	}
	try {
		const parsed = JSON.parse(res.stdout);
		const rows = parsed[0]?.results ?? parsed.results ?? [];
		return new Set(rows.map((r) => r.name));
	} catch {
		return new Set();
	}
}

function isAlreadyAppliedError(stderr) {
	return /duplicate column name|already exists|table .* already exists/i.test(
		stderr,
	);
}

console.log(`▶ migrate.mjs target=${target}`);

// 1. Ensure tracking table.
const ensure = wrangler({ command: TRACKING_TABLE_SQL });
if (!ensure.ok) {
	console.error("✗ Failed to create schema_migrations:");
	console.error(ensure.stderr || ensure.stdout || ensure.message);
	process.exit(1);
}

// 2. Read applied set + pending file list.
const applied = listApplied() ?? new Set();
const files = readdirSync(MIGRATIONS_DIR)
	.filter((f) => f.endsWith(".sql"))
	.sort();

console.log(
	`  ${applied.size} migration(s) already recorded, ${files.length} file(s) on disk`,
);

// 3. Apply pending in order.
let runCount = 0;
let backfillCount = 0;
for (const file of files) {
	if (applied.has(file)) continue;
	const filePath = resolve(MIGRATIONS_DIR, file);
	const res = wrangler({ file: filePath });
	if (res.ok) {
		const rec = wrangler({
			command: `INSERT OR IGNORE INTO schema_migrations (name) VALUES ('${file.replace(/'/g, "''")}');`,
		});
		if (!rec.ok) {
			console.error(`✗ recorded ${file} but failed to insert tracking row`);
			console.error(rec.stderr || rec.stdout);
			process.exit(1);
		}
		runCount += 1;
		console.log(`  ✓ ${file}`);
	} else if (isAlreadyAppliedError(res.stderr || res.stdout)) {
		// Backfill: DB already has this migration's effect but tracking row
		// is missing (legacy db:setup runs predate the tracking table).
		const rec = wrangler({
			command: `INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES ('${file.replace(/'/g, "''")}', datetime('now'));`,
		});
		if (!rec.ok) {
			console.error(`✗ failed to backfill tracking row for ${file}`);
			process.exit(1);
		}
		backfillCount += 1;
		console.log(`  ↻ ${file} (already applied; backfilled tracking)`);
	} else {
		console.error(`✗ ${file} failed:`);
		console.error(res.stderr || res.stdout || res.message);
		process.exit(1);
	}
}

console.log(
	`▶ done. applied=${runCount} backfilled=${backfillCount} skipped=${applied.size}`,
);
