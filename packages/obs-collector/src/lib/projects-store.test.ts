import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash";
import { displayPrefix, ProjectsStore } from "./projects-store";
import { createMigratedSqliteDb } from "./test-utils/node-sqlite-db";

describe("ProjectsStore.revokeKey", () => {
	it("only revokes a key through its own project", async () => {
		const db = createMigratedSqliteDb();
		const store = new ProjectsStore(db);
		const alpha = await store.createProject({ name: "Alpha", slug: "alpha" });
		const beta = await store.createProject({ name: "Beta", slug: "beta" });
		const betaKey = await store.createKey(beta.id, "ci");
		const hash = await sha256Hex(betaKey.key);

		// Alpha's admin cannot revoke beta's key by guessing its id.
		expect(await store.revokeKey(betaKey.id, alpha.id)).toBe(false);
		expect((await store.findByKeyHash(hash))?.projectId).toBe(beta.id);

		expect(await store.revokeKey(betaKey.id, beta.id)).toBe(true);
		expect(await store.findByKeyHash(hash)).toBeNull();
		// Already revoked: a second revoke reports nothing changed.
		expect(await store.revokeKey(betaKey.id, beta.id)).toBe(false);
		db.close();
	});
});

describe("bootstrap key display prefix", () => {
	it("never exposes a short bootstrap key in full", async () => {
		const db = createMigratedSqliteDb();
		const store = new ProjectsStore(db);
		await store.bootstrapEnvKey("short-key-12345"); // 15 chars
		const [key] = (await store.listKeys("default")).filter(
			(k) => k.name === "bootstrap",
		);
		expect(key?.keyPrefix).toBe("short");
		expect("short-key-12345".startsWith(key?.keyPrefix ?? "")).toBe(true);
		expect(key?.keyPrefix.length).toBeLessThan("short-key-12345".length);
		db.close();
	});

	it("keeps 16 chars for long keys, matching minted keys", () => {
		expect(displayPrefix("a".repeat(64))).toHaveLength(16);
		expect(displayPrefix("abc")).toBe("a");
		expect(displayPrefix("")).toBe("");
	});

	it("shrinks a legacy full-length prefix on the next bootstrap", async () => {
		const db = createMigratedSqliteDb();
		const store = new ProjectsStore(db);
		await store.bootstrapEnvKey("legacy-key-1234");
		await db
			.prepare(`UPDATE ingest_keys SET key_prefix = ? WHERE name = 'bootstrap'`)
			.bind("legacy-key-1234")
			.run();
		await store.bootstrapEnvKey("legacy-key-1234");
		const [key] = (await store.listKeys("default")).filter(
			(k) => k.name === "bootstrap",
		);
		expect(key?.keyPrefix).toBe("legac");
		db.close();
	});
});
