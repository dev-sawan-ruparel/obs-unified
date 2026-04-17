import type { Project } from "@obs/types";
import { useCallback, useEffect, useState } from "react";
import { useApi } from "../use-api";

export interface UseProjectsResult {
	projects: Project[];
	loading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}

export function useProjects(): UseProjectsResult {
	const api = useApi();
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await api<{ projects: Project[] }>("/projects");
			setProjects(data.projects ?? []);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [api]);

	useEffect(() => {
		load();
	}, [load]);

	return { projects, loading, error, refresh: load };
}
