import type {
	IngestKey,
	IngestKeyRow,
	IngestKeyWithPlaintext,
	Project,
	ProjectRow,
} from "@obs-unified/types";
import { randomHex, sha256Hex } from "./hash";
import type { SqlDb } from "./sql-db";

const rowToProject = (row: ProjectRow): Project => ({
	id: row.id,
	name: row.name,
	slug: row.slug,
	createdAt: row.created_at,
});

const rowToKey = (row: IngestKeyRow): IngestKey => ({
	id: row.id,
	projectId: row.project_id,
	name: row.name,
	keyPrefix: row.key_prefix,
	createdAt: row.created_at,
	revokedAt: row.revoked_at,
});

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;

export class ProjectsStore {
	constructor(private readonly db: SqlDb) {}

	async listProjects(): Promise<Project[]> {
		const rs = await this.db
			.prepare(`SELECT * FROM projects ORDER BY created_at ASC`)
			.all<ProjectRow>();
		return (rs.results ?? []).map(rowToProject);
	}

	async getProject(id: string): Promise<Project | null> {
		const row = await this.db
			.prepare(`SELECT * FROM projects WHERE id = ?`)
			.bind(id)
			.first<ProjectRow>();
		return row ? rowToProject(row) : null;
	}

	async createProject(input: {
		name: string;
		slug: string;
	}): Promise<Project> {
		const name = input.name.trim();
		const slug = input.slug.trim().toLowerCase();
		if (!name) throw new Error("Project name is required");
		if (!SLUG_PATTERN.test(slug))
			throw new Error(
				"Slug must be lowercase letters, digits, and hyphens (max 50 chars)",
			);

		const id = randomHex(16);
		const createdAt = new Date().toISOString();

		await this.db
			.prepare(
				`INSERT INTO projects (id, name, slug, created_at) VALUES (?, ?, ?, ?)`,
			)
			.bind(id, name, slug, createdAt)
			.run();

		return { id, name, slug, createdAt };
	}

	async updateProject(
		id: string,
		patch: { name?: string },
	): Promise<Project | null> {
		const existing = await this.getProject(id);
		if (!existing) return null;

		const name = patch.name?.trim();
		if (name !== undefined && name !== existing.name) {
			await this.db
				.prepare(`UPDATE projects SET name = ? WHERE id = ?`)
				.bind(name, id)
				.run();
			return { ...existing, name };
		}
		return existing;
	}

	async ensureDefaultProject(): Promise<void> {
		await this.db
			.prepare(
				`INSERT OR IGNORE INTO projects (id, name, slug, created_at) VALUES ('default', 'Default', 'default', ?)`,
			)
			.bind(new Date().toISOString())
			.run();
	}

	// ── Ingest keys ──

	async listKeys(projectId: string): Promise<IngestKey[]> {
		const rs = await this.db
			.prepare(
				`SELECT * FROM ingest_keys WHERE project_id = ? ORDER BY created_at DESC`,
			)
			.bind(projectId)
			.all<IngestKeyRow>();
		return (rs.results ?? []).map(rowToKey);
	}

	async createKey(
		projectId: string,
		name: string,
	): Promise<IngestKeyWithPlaintext> {
		const project = await this.getProject(projectId);
		if (!project) throw new Error("Project not found");

		const trimmedName = name.trim() || "unnamed";
		const id = randomHex(16);
		const plaintext = `obs_${project.slug}_${randomHex(24)}`;
		const keyHash = await sha256Hex(plaintext);
		// Prefix: show enough to identify but not recover (first 16 chars).
		const keyPrefix = plaintext.slice(0, 16);
		const createdAt = new Date().toISOString();

		await this.db
			.prepare(
				`INSERT INTO ingest_keys (id, project_id, key_hash, key_prefix, name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.bind(id, projectId, keyHash, keyPrefix, trimmedName, createdAt)
			.run();

		return {
			id,
			projectId,
			name: trimmedName,
			keyPrefix,
			createdAt,
			revokedAt: null,
			key: plaintext,
			warning: "This key will not be shown again. Store it somewhere safe.",
		};
	}

	async revokeKey(keyId: string): Promise<boolean> {
		const result = await this.db
			.prepare(
				`UPDATE ingest_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
			)
			.bind(new Date().toISOString(), keyId)
			.run();
		return (result.meta?.changes ?? 0) > 0;
	}

	async findByKeyHash(
		keyHash: string,
	): Promise<{ projectId: string; keyId: string } | null> {
		const row = await this.db
			.prepare(
				`SELECT id, project_id FROM ingest_keys WHERE key_hash = ? AND revoked_at IS NULL`,
			)
			.bind(keyHash)
			.first<{ id: string; project_id: string }>();
		return row ? { projectId: row.project_id, keyId: row.id } : null;
	}

	/**
	 * Idempotently register the legacy env INGEST_KEY as a bootstrap key on the
	 * default project, so existing deployments keep working without manual migration.
	 */
	async bootstrapEnvKey(plaintext: string): Promise<void> {
		if (!plaintext) return;
		await this.ensureDefaultProject();
		const keyHash = await sha256Hex(plaintext);
		const existing = await this.db
			.prepare(`SELECT id FROM ingest_keys WHERE key_hash = ?`)
			.bind(keyHash)
			.first<{ id: string }>();
		if (existing) return;

		const id = randomHex(16);
		const keyPrefix = plaintext.slice(0, Math.min(16, plaintext.length));
		const createdAt = new Date().toISOString();
		await this.db
			.prepare(
				`INSERT INTO ingest_keys (id, project_id, key_hash, key_prefix, name, created_at) VALUES (?, 'default', ?, ?, 'bootstrap', ?)`,
			)
			.bind(id, keyHash, keyPrefix, createdAt)
			.run();
	}
}
