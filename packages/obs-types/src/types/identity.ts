import type { JsonValue } from "./primitives";

export interface IdentifyInput {
	visitorId: string;
	userId: string;
	email?: string;
	name?: string;
	properties?: Record<string, JsonValue>;
	/**
	 * Optional ISO timestamp for the user's first observed activity.
	 * When the SDK calls identify() at runtime this is always "now"; the
	 * field exists for backfill / replay imports / synthetic seeds where
	 * the historical first-seen-at would otherwise collapse to identify-
	 * call time. Server clamps to ISO and ignores values in the future.
	 */
	firstSeenAt?: string;
}

export interface UserProfileRow {
	project_id: string;
	user_id: string;
	visitor_id: string;
	email: string | null;
	name: string | null;
	properties_json: string | null;
	first_seen_at: string;
	last_seen_at: string;
}

export interface UserProfileDetail {
	userId: string;
	visitorId: string;
	email: string | null;
	name: string | null;
	properties: Record<string, JsonValue>;
	firstSeenAt: string;
	lastSeenAt: string;
}
