import type { CollectorPlugin } from "../framework/collector";
import { ProjectsStore } from "../lib/projects-store";
import { sqlDbFor } from "../lib/sql-db";

export const projectsRoutesPlugin: CollectorPlugin = {
	name: "projects-routes",
	register(app) {
		app.get("/internal/projects", async (c) => {
			const store = new ProjectsStore(sqlDbFor(c.env));
			await store.ensureDefaultProject();
			const projects = await store.listProjects();
			return c.json({ projects });
		});

		app.post("/internal/projects", async (c) => {
			const body = await c.req
				.json<{ name?: string; slug?: string }>()
				.catch(() => ({ name: undefined, slug: undefined }));
			if (!body.name || !body.slug) {
				return c.json({ error: "name and slug are required" }, 400);
			}
			const store = new ProjectsStore(sqlDbFor(c.env));
			try {
				const project = await store.createProject({
					name: body.name,
					slug: body.slug,
				});
				return c.json({ project }, 201);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				// UNIQUE constraint failures from D1 surface as "D1_ERROR" with a cause.
				if (message.includes("UNIQUE") || message.toLowerCase().includes("slug")) {
					return c.json({ error: "Slug already in use or invalid" }, 409);
				}
				return c.json({ error: message }, 400);
			}
		});

		app.patch("/internal/projects/:id", async (c) => {
			const id = c.req.param("id");
			const body = await c.req
				.json<{ name?: string }>()
				.catch(() => ({ name: undefined }));
			const store = new ProjectsStore(sqlDbFor(c.env));
			const project = await store.updateProject(id, { name: body.name });
			if (!project) return c.json({ error: "Project not found" }, 404);
			return c.json({ project });
		});

		app.get("/internal/projects/:id/keys", async (c) => {
			const id = c.req.param("id");
			const store = new ProjectsStore(sqlDbFor(c.env));
			const project = await store.getProject(id);
			if (!project) return c.json({ error: "Project not found" }, 404);
			const keys = await store.listKeys(id);
			return c.json({ keys });
		});

		app.post("/internal/projects/:id/keys", async (c) => {
			const id = c.req.param("id");
			const body = await c.req
				.json<{ name?: string }>()
				.catch(() => ({ name: undefined }));
			const store = new ProjectsStore(sqlDbFor(c.env));
			try {
				const result = await store.createKey(id, body.name ?? "unnamed");
				return c.json(result, 201);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return c.json({ error: message }, 400);
			}
		});

		app.delete("/internal/projects/:id/keys/:keyId", async (c) => {
			const keyId = c.req.param("keyId");
			const store = new ProjectsStore(sqlDbFor(c.env));
			const revoked = await store.revokeKey(keyId);
			if (!revoked) return c.json({ error: "Key not found or already revoked" }, 404);
			return c.json({ success: true });
		});
	},
};
