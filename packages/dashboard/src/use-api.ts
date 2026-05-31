import { useCallback } from "react";
import { useDashboard } from "./provider";

export function isAbortError(err: unknown): boolean {
	return err instanceof DOMException && err.name === "AbortError";
}

export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Returns a fetch-like function that prepends the configured basePath
 * and uses the dashboard's fetcher (which includes credentials by default).
 *
 * Usage:
 *   const api = useApi();
 *   const data = await api("/telemetry/overview?hours=72");
 */
export function useApi() {
	const { basePath, fetcher } = useDashboard();

	return useCallback(
		async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
			const url = `${basePath}${path}`;
			const response = await fetcher(url, init);
			if (!response.ok) {
				throw new Error(`API error: ${response.status}`);
			}
			return response.json() as Promise<T>;
		},
		[basePath, fetcher],
	);
}

/**
 * Returns a raw fetch function that prepends basePath.
 * For cases where you need the Response object (streaming, exports, etc).
 */
export function useRawFetch() {
	const { basePath, fetcher } = useDashboard();

	return useCallback(
		(path: string, init?: RequestInit) => {
			const url = `${basePath}${path}`;
			return fetcher(url, init);
		},
		[basePath, fetcher],
	);
}
