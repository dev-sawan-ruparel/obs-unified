/**
 * Parse a request body that must be a JSON object. `c.req.json()` happily
 * returns `null`, arrays and primitives for bodies like `null` or `"x"`, and
 * the first property access in the handler then threw a TypeError that
 * surfaced as a 500. Returns `null` for anything that is not a plain object
 * so routes can answer 400 uniformly.
 */
export async function readJsonObject<T extends object>(c: {
	req: { json(): Promise<unknown> };
}): Promise<T | null> {
	let parsed: unknown;
	try {
		parsed = await c.req.json();
	} catch {
		return null;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	return parsed as T;
}
