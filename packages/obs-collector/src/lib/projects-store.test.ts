import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash";
import { ProjectsStore } from "./projects-store";
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
