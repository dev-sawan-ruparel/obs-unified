export interface ReplayChunkInput {
	sessionId: string;
	visitorId: string;
	sequenceNumber: number;
	events: Record<string, unknown>[]; // rrweb event objects
}

export interface SessionReplayMetadataRow {
	project_id: string;
	session_id: string;
	visitor_id: string;
	first_chunk_at: string;
	last_chunk_at: string;
	chunk_count: number;
	events_count: number;
	storage_bytes: number;
}

// ── Projects & Ingest Keys ──
