import type { ReplayRow } from "./types";
import { fmtBytes, fmtDur, fmtTs } from "./utils";

export function ReplayList({
	width,
	replays,
	loading,
	selectedSessionId,
	onOpenSession,
}: {
	width: number;
	replays: ReplayRow[];
	loading: boolean;
	selectedSessionId: string | null;
	onOpenSession: (sessionId: string) => void;
}) {
	return (
		<div
			style={{ width }}
			className="flex-none bg-sys-surface flex flex-col h-full overflow-hidden border-[1px] border-sys-outline select-none"
		>
			<div className="flex-none p-3 border-b-[2px] border-sys-outline flex justify-between items-center">
				<span className="text-[0.875rem] font-semibold">Latest replays</span>
				<span className="text-[0.625rem] font-mono opacity-60 font-bold bg-sys-bg px-2 py-0.5">
					{replays.length} SESSIONS
				</span>
			</div>
			<div className="flex-1 overflow-y-auto cursor-default">
				{loading && (
					<div className="p-4 text-[0.75rem] font-semibold opacity-60 text-center">
						Loading replays...
					</div>
				)}
				{!loading && replays.length === 0 && (
					<div className="p-4 text-[0.75rem] font-semibold opacity-60 text-center">
						No replays found.
					</div>
				)}
				{replays.map((r) => {
					const active = r.session_id === selectedSessionId;
					return (
						<button
							type="button"
							key={r.session_id}
							onClick={() => onOpenSession(r.session_id)}
							className={`w-full text-left p-3 border-b-[1px] border-sys-outline transition-none cursor-pointer group hover:bg-sys-surface-low block ${active ? "bg-sys-surface-high border-l-[4px] border-l-sys-primary" : "border-l-[4px] border-l-transparent"}`}
						>
							<div className="flex items-center justify-between mb-1.5">
								<span
									className={`text-[0.75rem] font-bold font-mono truncate mr-2 ${active ? "text-sys-primary" : ""}`}
								>
									{r.visitor_id.substring(0, 16)}
								</span>
								<span className="text-[0.625rem] font-bold opacity-60 whitespace-nowrap">
									{fmtDur(r.first_chunk_at, r.last_chunk_at)}
								</span>
							</div>
							<div className="text-[0.875rem] font-bold truncate opacity-90 mb-1 leading-snug">
								{r.starting_link || "Unknown Path"}
							</div>
							<div className="flex items-center justify-between">
								<span className="text-[0.625rem] bg-sys-bg px-1.5 py-0.5 border border-sys-outline opacity-80">
									{r.events_count} EVENTS
								</span>
								<span className="text-[0.625rem] bg-sys-bg px-1.5 py-0.5 border border-sys-outline opacity-80">
									{fmtBytes(
										r.storage_bytes ||
											(r.events_count ? r.events_count * 65 : 0),
									)}
								</span>
								<span className="text-[0.625rem] opacity-50 font-mono tracking-tighter truncate">
									{fmtTs(r.first_chunk_at)}
								</span>
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}
