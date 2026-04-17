import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

export interface DashboardConfig {
	/** Base path for collector API endpoints. Default: "/internal" */
	basePath: string;
	/** Custom fetch function. Default: fetch with credentials: "include" and X-Project-Id header */
	fetcher: typeof fetch;
	/** Currently selected project id (defaults to 'default') */
	projectId: string;
	/** Change the active project id. Persists to localStorage. */
	setProjectId: (id: string) => void;
}

const DashboardContext = createContext<DashboardConfig | null>(null);
const LOCAL_STORAGE_KEY = "obs.selectedProjectId";

export function useDashboard(): DashboardConfig {
	const ctx = useContext(DashboardContext);
	if (!ctx) {
		throw new Error("useDashboard must be used within <ObsDashboardProvider>");
	}
	return ctx;
}

function readInitialProjectId(): string {
	if (typeof localStorage === "undefined") return "default";
	try {
		return localStorage.getItem(LOCAL_STORAGE_KEY) || "default";
	} catch {
		return "default";
	}
}

function writeProjectId(id: string): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(LOCAL_STORAGE_KEY, id);
	} catch {
		// ignore
	}
}

/**
 * Provides configuration to all dashboard components.
 *
 * Injects `X-Project-Id` on every request via the default fetcher so
 * query routes can filter by project. Consumers can override `fetcher`
 * for auth proxies; they're responsible for propagating the header
 * themselves in that case.
 */
export function ObsDashboardProvider({
	basePath = "/internal",
	fetcher,
	children,
}: {
	basePath?: string;
	fetcher?: typeof fetch;
	children: ReactNode;
}) {
	const [projectId, setProjectIdState] = useState<string>(readInitialProjectId);

	useEffect(() => {
		writeProjectId(projectId);
	}, [projectId]);

	const setProjectId = useCallback((id: string) => {
		setProjectIdState(id);
	}, []);

	const config = useMemo<DashboardConfig>(() => {
		const defaultFetcher: typeof fetch = (input, init) => {
			const headers = new Headers(init?.headers);
			if (!headers.has("X-Project-Id")) {
				headers.set("X-Project-Id", projectId);
			}
			return fetch(input, {
				...init,
				credentials: "include",
				headers,
			});
		};
		return {
			basePath: basePath.replace(/\/$/, ""),
			fetcher: fetcher ?? defaultFetcher,
			projectId,
			setProjectId,
		};
	}, [basePath, fetcher, projectId, setProjectId]);

	return (
		<DashboardContext.Provider value={config}>
			{children}
		</DashboardContext.Provider>
	);
}
