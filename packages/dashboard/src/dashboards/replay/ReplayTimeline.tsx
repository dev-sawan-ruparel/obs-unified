import type { ReplayTimelineEntry, TimelineGroup } from "./types";
import { copy, fmtTs } from "./utils";

export function ReplayTimeline({
	entries,
	activeEvent,
	copyValue,
	onNavigate,
	interactionGroups = {},
}: {
	entries: ReplayTimelineEntry[];
	activeEvent: string | null;
	copyValue: unknown;
	onNavigate?: (route: { tab?: string; traceId?: string }) => void;
	interactionGroups?: Record<string, TimelineGroup>;
}) {
	return (
		<div className="bg-sys-surface flex-1 flex flex-col min-h-0 border-[1px] border-sys-outline">
			<div className="bg-sys-surface-low border-b-[2px] border-sys-outline flex items-center justify-between px-3 py-2">
				<span className="text-[0.875rem] font-semibold">
					Full event stream ({entries.length} entries)
				</span>
				<button
					type="button"
					className="text-[0.75rem] font-semibold hover:text-sys-primary cursor-pointer transition-none underline"
					onClick={() => copy(JSON.stringify(copyValue, null, 2))}
				>
					Copy JSON
				</button>
			</div>
			<div className="flex-1 overflow-y-auto pb-4">
				{entries.map((ev) => {
					const isActive = ev.timelineKey === activeEvent;
					const group = ev.interactionId
						? interactionGroups?.[ev.interactionId]
						: null;
					return (
						<div
							key={ev.timelineKey}
							className={`flex items-start gap-2 py-1.5 px-3 border-b-[1px] border-sys-surface-low font-mono text-[0.75rem] transition-none ${
								isActive
									? "bg-sys-surface-high border-l-[4px] border-l-sys-primary"
									: ev.isTrace
										? "hover:bg-sys-surface-high border-l-[4px] border-l-transparent"
										: "hover:bg-sys-surface-low border-l-[4px] border-l-transparent"
							} ${!isActive && ev.severity === "error" ? "bg-sys-error/10 text-sys-error" : ""}`}
						>
							<span
								className={`w-32 flex-none font-bold py-1 ${
									isActive
										? "text-sys-primary"
										: ev.isTrace
											? "text-sys-on-surface opacity-80"
											: "opacity-60"
								}`}
							>
								{ev.eventType.toUpperCase()}
							</span>
							<span className="min-w-0 flex-1">
								<div className="font-bold text-[0.875rem] mb-1">
									{ev.eventName}
								</div>
								{Object.keys(ev.properties).length > 0 && (
									<div className="flex flex-wrap gap-2 opacity-80 mt-2">
										{Object.entries(ev.properties).map(([k, v]) => (
											<span
												key={k}
												className="bg-sys-bg px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em]"
											>
												{k}: {typeof v === "string" ? v : JSON.stringify(v)}
											</span>
										))}
										{typeof ev.properties.traceId === "string" && (
											<button
												type="button"
												onClick={() =>
													onNavigate?.({
														tab: "traces",
														traceId: ev.properties.traceId as string,
													})
												}
												className="bg-sys-primary px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] text-white hover:bg-sys-primary-strong cursor-pointer border border-sys-primary/20"
											>
												View trace
											</button>
										)}
									</div>
								)}

								{ev.eventType === "interaction" && (
									<div className="mt-2 text-[0.75rem] border-l-[2px] border-sys-outline pl-2 bg-sys-surface-low p-2">
										<div className="font-semibold text-sys-on-surface opacity-80 uppercase text-[0.625rem] tracking-[0.05em] mb-1">
											Causality & Evidence
										</div>
										{group ? (
											<div className="space-y-2">
												{group.causedTraces && group.causedTraces.length > 0 ? (
													<div className="space-y-1">
														<div className="text-[0.6875rem] opacity-70">
															Caused Traces:
														</div>
														{group.causedTraces.map((trace) => (
															<div
																key={trace.traceId}
																className="flex items-center gap-2"
															>
																<button
																	type="button"
																	onClick={() =>
																		onNavigate?.({
																			tab: "traces",
																			traceId: trace.traceId,
																		})
																	}
																	className="text-sys-primary hover:underline font-mono text-[0.75rem] font-bold text-left cursor-pointer"
																>
																	{trace.traceId.slice(0, 8)} ·{" "}
																	{trace.rootSpanName} ({trace.serviceName})
																</button>
																<span className="text-[0.6875rem] opacity-60 font-mono">
																	{trace.durationMs}ms
																</span>
																<span
																	className={`text-[0.625rem] px-1 font-bold ${trace.status === "error" ? "bg-sys-error/25 text-sys-error" : "bg-sys-primary/25 text-sys-primary"}`}
																>
																	{trace.status.toUpperCase()}
																</span>
															</div>
														))}
													</div>
												) : (
													<div className="text-[0.6875rem] opacity-60 italic">
														No caused backend traces were recorded for this
														interaction.
													</div>
												)}

												{group.relatedEvents &&
												group.relatedEvents.length > 0 ? (
													<div className="space-y-1">
														<div className="text-[0.6875rem] opacity-70">
															Related Events:
														</div>
														<div className="flex flex-wrap gap-1">
															{group.relatedEvents.map((evt) => (
																<span
																	key={`${evt.kind}-${evt.id}`}
																	className="bg-sys-surface px-1.5 py-0.5 border border-sys-outline font-mono text-[0.6875rem]"
																>
																	{evt.kind}: {evt.id.slice(0, 8)}
																</span>
															))}
														</div>
													</div>
												) : null}
											</div>
										) : (
											<div className="text-[0.6875rem] opacity-60 italic">
												No backend traces or logs mapped to this interaction (no
												replay captured).
											</div>
										)}
									</div>
								)}
							</span>
							<span className="flex-none max-w-[200px] truncate text-right py-1 opacity-60">
								{ev.pagePath || "—"}
							</span>
							<span className="flex-none whitespace-nowrap w-[140px] text-right py-1 opacity-80">
								{fmtTs(ev.occurredAt)}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
