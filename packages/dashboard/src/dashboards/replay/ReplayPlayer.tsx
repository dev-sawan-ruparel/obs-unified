import { useEffect, useRef, useState } from "react";
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";
import { useDashboard } from "../../provider";
import type { ReplayChunkPage, RrwebEvent } from "./types";

type RrwebUiUpdateEvent = {
	payload?: unknown;
	detail?: unknown;
};

export function ReplayPlayer({
	sessionId,
	onTimeUpdate,
}: {
	sessionId: string;
	onTimeUpdate?: (timeValue: number) => void;
}) {
	const { basePath, fetcher } = useDashboard();
	const [events, setEvents] = useState<RrwebEvent[] | null>(null);
	const [loading, setLoading] = useState(true);
	// Tri-state: "" (no message yet), { kind: "absence" } (expected — no
	// rrweb chunks were ever recorded for this session), or { kind: "error" }
	// (something actually went wrong — network, 5xx, parse). Absence renders
	// as informative-absence per RFC 0006; error keeps the red treatment.
	const [issue, setIssue] = useState<{
		kind: "absence" | "error";
		message: string;
	} | null>(null);
	const playerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setIssue(null);
		setEvents(null);

		const loadReplay = async () => {
			const allEvents: RrwebEvent[] = [];
			let chunkOffset: number | null = 0;
			while (!cancelled && chunkOffset !== null) {
				const r = await fetcher(
					`${basePath}/replays/${encodeURIComponent(sessionId)}?chunkOffset=${chunkOffset}&chunkLimit=100`,
				);
				if (cancelled) return;
				if (r.status === 404) {
					setIssue({
						kind: "absence",
						message:
							'No rrweb replay was recorded for this session. Visit /playground and click "Start replay" to capture one in a real browser.',
					});
					return;
				}
				if (!r.ok) {
					setIssue({
						kind: "error",
						message: `Replay fetch failed: ${r.status} ${r.statusText}`,
					});
					return;
				}
				const data = (await r.json()) as ReplayChunkPage;
				allEvents.push(...(data.events ?? []));
				chunkOffset = data.chunks?.nextChunkOffset ?? null;
			}
			if (cancelled) return;
			if (allEvents.length > 2) {
				setEvents(allEvents);
			} else {
				setIssue({
					kind: "absence",
					message:
						"Session exists but has too few rrweb events to render. Replays under ~3 frames are skipped.",
				});
			}
		};

		loadReplay()
			.catch((e) => {
				if (!cancelled) {
					setIssue({
						kind: "error",
						message: e instanceof Error ? e.message : String(e),
					});
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [sessionId, fetcher, basePath]);

	useEffect(() => {
		if (events && playerRef.current) {
			playerRef.current.innerHTML = "";
			const player = new rrwebPlayer({
				target: playerRef.current,
				props: {
					events,
					autoPlay: true,
					width: playerRef.current.clientWidth,
				},
			});
			const handleTimeUpdate = (e: unknown) => {
				const update = e as RrwebUiUpdateEvent;
				const offset = update.payload ?? update.detail;
				if (typeof offset === "number" && events[0]?.timestamp) {
					onTimeUpdate?.(events[0].timestamp + offset);
				}
			};
			if (onTimeUpdate) {
				player.addEventListener("ui-update-current-time", handleTimeUpdate);
			}
			return () => {
				try {
					if (onTimeUpdate) {
						(
							player as unknown as {
								removeEventListener?: typeof player.addEventListener;
							}
						).removeEventListener?.("ui-update-current-time", handleTimeUpdate);
					}
					player.pause();
					(player as unknown as { destroy?: () => void }).destroy?.();
				} catch {}
			};
		}
	}, [events, onTimeUpdate]);

	if (loading)
		return (
			<div className="text-[0.8125rem] text-sys-on-surface-muted p-3 text-center">
				Loading replay visual buffer…
			</div>
		);
	if (issue?.kind === "absence")
		return (
			<div
				className="text-[0.8125rem] text-sys-on-surface-muted p-3 italic border-[1px] border-sys-outline-soft"
				title={issue.message}
			>
				— {issue.message}
			</div>
		);
	if (issue?.kind === "error")
		return (
			<div className="text-[0.8125rem] font-medium text-sys-error p-3 text-center border-[2px] border-sys-error bg-sys-error/10">
				{issue.message}
			</div>
		);

	return (
		<div className="bg-sys-bg border-[2px] border-sys-outline">
			<div ref={playerRef} className="w-full bg-sys-bg" />
		</div>
	);
}
