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
	/** Global time window in minutes. Dashboards can opt in to read this. */
	timeWindowMins: number;
	/** Change the global time window. Persists to localStorage. */
	setTimeWindowMins: (mins: number) => void;
}

const DashboardContext = createContext<DashboardConfig | null>(null);
const LOCAL_STORAGE_KEY = "obs.selectedProjectId";
const TIME_WINDOW_KEY = "obs.timeWindowMins";
const DEFAULT_TIME_WINDOW_MINS = 360;

export function useDashboard(): DashboardConfig {
	const ctx = useContext(DashboardContext);
	if (!ctx) {
		throw new Error("useDashboard must be used within <ObsDashboardProvider>");
	}
	return ctx;
}

/**
 * Hours derived from the global TimeRangePicker. Minimum 1.
 * Use this instead of a per-dashboard `useState("hours")`.
 */
export function useTimeWindowHours(): number {
	const { timeWindowMins } = useDashboard();
	return Math.max(1, Math.round(timeWindowMins / 60));
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

function readInitialTimeWindow(): number {
	if (typeof localStorage === "undefined") return DEFAULT_TIME_WINDOW_MINS;
	try {
		const raw = localStorage.getItem(TIME_WINDOW_KEY);
		const n = raw ? Number(raw) : NaN;
		return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIME_WINDOW_MINS;
	} catch {
		return DEFAULT_TIME_WINDOW_MINS;
	}
}

function writeTimeWindow(mins: number): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(TIME_WINDOW_KEY, String(mins));
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
	const [timeWindowMins, setTimeWindowMinsState] = useState<number>(readInitialTimeWindow);

	useEffect(() => {
		writeProjectId(projectId);
	}, [projectId]);

	useEffect(() => {
		writeTimeWindow(timeWindowMins);
	}, [timeWindowMins]);

	const setProjectId = useCallback((id: string) => {
		setProjectIdState(id);
	}, []);

	const setTimeWindowMins = useCallback((mins: number) => {
		setTimeWindowMinsState(mins);
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
			timeWindowMins,
			setTimeWindowMins,
		};
	}, [basePath, fetcher, projectId, setProjectId, timeWindowMins, setTimeWindowMins]);

	return (
		<DashboardContext.Provider value={config}>
			{children}
		</DashboardContext.Provider>
	);
}
