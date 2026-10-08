// ── Helpers ──

export const createId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
};

export const safeStorage = (
	storage: Storage,
	key: string,
	value?: string,
): string | null => {
	try {
		if (value !== undefined) {
			storage.setItem(key, value);
			return value;
		}
		return storage.getItem(key);
	} catch {
		return null;
	}
};

export const getStorageValue = (storage: Storage, key: string): string => {
	const existing = safeStorage(storage, key);
	if (existing) return existing;
	const next = createId();
	safeStorage(storage, key, next);
	return next;
};

/** Truncate string values to max length (from A) */
export const truncateValue = (value: unknown, maxLength: number): unknown => {
	if (typeof value === "string" && value.length > maxLength) {
		return value.slice(0, maxLength);
	}
	return value;
};

/** Normalize metadata: filter undefined, truncate strings (from A) */
export const normalizeMetadata = (
	data: Record<string, unknown> | undefined,
	maxLength: number,
): Record<string, unknown> | undefined => {
	if (!data) return undefined;
	const entries = Object.entries(data)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => [k, truncateValue(v, maxLength)]);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

export const getUtmParams = (): Record<string, string> => {
	if (typeof window === "undefined") return {};
	const params = new URLSearchParams(window.location.search);
	const utm: Record<string, string> = {};
	for (const key of [
		"utm_source",
		"utm_medium",
		"utm_campaign",
		"utm_term",
		"utm_content",
	]) {
		const value = params.get(key);
		if (value) utm[key.replace("utm_", "utm")] = value;
	}
	return utm;
};

export const getViewportContext = (): Record<string, unknown> => {
	if (typeof window === "undefined") return {};
	return {
		viewportWidth: window.innerWidth,
		viewportHeight: window.innerHeight,
	};
};
