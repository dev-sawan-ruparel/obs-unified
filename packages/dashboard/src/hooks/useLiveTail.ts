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
	const { basePath, fetcher } = useDashboard();
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
		let cancelled = false;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const controller = new AbortController();
		const url = `${basePath}/telemetry/tail?kinds=${encodeURIComponent(kindsKey)}`;

		const handleTailPayload = (data: string) => {
			try {
				const parsed = JSON.parse(data) as TailEvent[];
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
		};

		const processFrame = (frame: string) => {
			const lines = frame.split(/\r?\n/);
			let eventName = "message";
			const data: string[] = [];
			for (const line of lines) {
				if (line.startsWith("event:")) {
					eventName = line.slice("event:".length).trim();
				} else if (line.startsWith("data:")) {
					data.push(line.slice("data:".length).trimStart());
				}
			}
			if (eventName === "tail" && data.length > 0) {
				handleTailPayload(data.join("\n"));
			}
		};

		const connect = async () => {
			try {
				const res = await fetcher(url, {
					method: "GET",
					headers: { Accept: "text/event-stream" },
					signal: controller.signal,
				});
				if (!res.ok) throw new Error(`Live tail failed: ${res.status}`);
				if (!res.body) throw new Error("Live tail response has no body");
				if (cancelled) return;
				setConnected(true);
				setError(null);

				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				while (!cancelled) {
					const { value, done } = await reader.read();
					if (done) break;
					buffer += decoder.decode(value, { stream: true });
					const frames = buffer.split(/\r?\n\r?\n/);
					buffer = frames.pop() ?? "";
					for (const frame of frames) {
						processFrame(frame);
					}
				}
				buffer += decoder.decode();
				if (buffer.trim()) processFrame(buffer);
			} catch (err) {
				if (cancelled || controller.signal.aborted) return;
				console.error("[useLiveTail] stream error:", err);
			} finally {
				if (!cancelled) {
					setConnected(false);
					setError("Disconnected - retrying...");
					retryTimer = setTimeout(connect, 1000);
				}
			}
		};

		void connect();

		return () => {
			cancelled = true;
			if (retryTimer) clearTimeout(retryTimer);
			controller.abort();
			setConnected(false);
		};
	}, [basePath, fetcher, kindsKey, enabled, maxRows]);

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
