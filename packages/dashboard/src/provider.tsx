import { createContext, type ReactNode, useContext, useMemo } from "react";

export interface DashboardConfig {
	/** Base path for collector API endpoints. Default: "/internal" */
	basePath: string;
	/** Custom fetch function. Default: fetch with credentials: "include" */
	fetcher: typeof fetch;
}

const DashboardContext = createContext<DashboardConfig | null>(null);

export function useDashboard(): DashboardConfig {
	const ctx = useContext(DashboardContext);
	if (!ctx) {
		throw new Error("useDashboard must be used within <ObsDashboardProvider>");
	}
	return ctx;
}

/**
 * Provides configuration to all dashboard components.
 *
 * @example
 * // Standalone (served by collector, same origin)
 * <ObsDashboardProvider>
 *   <TelemetryDashboard />
 * </ObsDashboardProvider>
 *
 * @example
 * // Embedded in your app (proxied through your API)
 * <ObsDashboardProvider basePath="/api/admin" fetcher={myAuthFetch}>
 *   <TelemetryDashboard />
 * </ObsDashboardProvider>
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
	const config = useMemo<DashboardConfig>(() => {
		const defaultFetcher: typeof fetch = (input, init) =>
			fetch(input, { ...init, credentials: "include" });
		return {
			basePath: basePath.replace(/\/$/, ""),
			fetcher: fetcher ?? defaultFetcher,
		};
	}, [basePath, fetcher]);

	return (
		<DashboardContext.Provider value={config}>
			{children}
		</DashboardContext.Provider>
	);
}
