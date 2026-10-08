/**
 * Extract the project id set by ingest-auth or dashboard-auth middleware.
 * Returns 'default' when no middleware has attached one (e.g. unauth dev).
 *
 * Uses a loose Context typing so plugins don't need to re-declare `Variables`
 * on every route registration. The underlying value is always a string set by
 * the auth middlewares.
 */
interface ProjectContext {
	get(key: "projectId"): string | undefined;
}

export function getProjectId(c: ProjectContext): string {
	return (c.get("projectId") as string | undefined) || "default";
}
