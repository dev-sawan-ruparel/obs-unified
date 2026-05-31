import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboard } from "../provider";

export type TailKind = "span" | "log";

export interface TailEvent<T = unknown> {
	kind: TailKind;
	projectId: string;
	row: T;
	t: string;
}

export interface UseLiveTailOptions {
	kinds?: TailKind[];
	maxRows?: number;
	enabled?: boolean;
}

export interface UseLiveTailResult<T> {
	rows: T[];
	paused: boolean;
	buffered: number;
	togglePause: () => void;
	clear: () => void;
	connected: boolean;
	error: string | null;
}

/**
 * Subscribe to live-tailed telemetry via SSE. Filters events by `kind` on the
 * server and by `predicate` on the client. Pause buffers incoming rows until
 * the user resumes — no dropped events during a pause.
 */
export function useLiveTail<T>(
	predicate: (event: TailEvent) => event is TailEvent<T>,
	options: UseLiveTailOptions = {},
): UseLiveTailResult<T> {
	const { basePath, projectId } = useDashboard();
	const { kinds = ["span", "log"], maxRows = 500, enabled = true } = options;
	const kindsKey = kinds.join(",");

	const [rows, setRows] = useState<T[]>([]);
	const [paused, setPaused] = useState(false);
	const [buffered, setBuffered] = useState(0);
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const pausedRef = useRef(paused);
	pausedRef.current = paused;
	const bufferRef = useRef<T[]>([]);
	const predicateRef = useRef(predicate);
	predicateRef.current = predicate;

	useEffect(() => {
		if (!enabled) return;
		const url = `${basePath}/telemetry/tail?kinds=${encodeURIComponent(
			kindsKey,
		)}&projectId=${encodeURIComponent(projectId)}`;
		const source = new EventSource(url, { withCredentials: true });

		source.onopen = () => {
			setConnected(true);
			setError(null);
		};
		source.onerror = () => {
			setConnected(false);
			setError("Disconnected — retrying…");
		};
		source.addEventListener("tail", (event) => {
			try {
				const parsed = JSON.parse((event as MessageEvent).data) as TailEvent[];
				const matched: T[] = [];
				for (const e of parsed) {
					if (predicateRef.current(e)) matched.push(e.row);
				}
				if (matched.length === 0) return;
				const newest = matched.sort(
					(a, b) => rowTimestamp(b) - rowTimestamp(a),
				);
				if (pausedRef.current) {
					bufferRef.current = [...newest, ...bufferRef.current].slice(
						0,
						maxRows,
					);
					setBuffered(bufferRef.current.length);
				} else {
					setRows((prev) => [...newest, ...prev].slice(0, maxRows));
				}
			} catch (err) {
				console.error("[useLiveTail] parse error:", err);
			}
		});

		return () => {
			source.close();
			setConnected(false);
		};
	}, [basePath, projectId, kindsKey, enabled, maxRows]);

	const togglePause = useCallback(() => {
		setPaused((prev) => {
			const next = !prev;
			if (!next && bufferRef.current.length > 0) {
				// Capture buffer snapshot before clearing — setRows runs its
				// updater asynchronously and would otherwise close over the
				// cleared ref.
				const drained = bufferRef.current;
				bufferRef.current = [];
				setBuffered(0);
				setRows((current) => [...drained, ...current].slice(0, maxRows));
			}
			return next;
		});
	}, [maxRows]);

	const clear = useCallback(() => {
		setRows([]);
		bufferRef.current = [];
		setBuffered(0);
	}, []);

	return { rows, paused, buffered, togglePause, clear, connected, error };
}

function rowTimestamp(row: unknown): number {
	if (!row || typeof row !== "object") return 0;
	const record = row as Record<string, unknown>;
	const value = record.occurredAt ?? record.startTime ?? record.t ?? 0;
	return new Date(String(value)).getTime();
}
