export interface Project {
	id: string;
	name: string;
	slug: string;
	createdAt: string;
}

export interface ProjectRow {
	id: string;
	name: string;
	slug: string;
	created_at: string;
}

export interface IngestKey {
	id: string;
	projectId: string;
	name: string;
	keyPrefix: string;
	createdAt: string;
	revokedAt: string | null;
}

export interface IngestKeyRow {
	id: string;
	project_id: string;
	key_hash: string;
	key_prefix: string;
	name: string;
	created_at: string;
	revoked_at: string | null;
}

/** Response from POST /internal/projects/:id/keys — plaintext key is returned exactly once */
export interface IngestKeyWithPlaintext extends IngestKey {
	key: string;
	warning: string;
}
