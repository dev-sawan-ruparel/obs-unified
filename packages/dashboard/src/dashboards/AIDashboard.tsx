import { useCallback, useEffect, useState } from "react";
import type { AICallsOverviewResponse } from "@obs/types";
import { useApi } from "../use-api";

export function AIDashboard() {
	const api = useApi();
	const [overview, setOverview] = useState<AICallsOverviewResponse | null>(null);
	const [hours, setHours] = useState("24");
	const [loading, setLoading] = useState(false);

	const loadAll = useCallback(async () => {
		setLoading(true);
		try {
			const data = await api<AICallsOverviewResponse>(`/ai/overview?hours=${hours}`);
			setOverview(data);
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	}, [hours, api]);

	useEffect(() => {
		loadAll();
	}, [loadAll]);

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg font-sans text-sys-on-surface p-2">
			<div className="mb-2 flex-none flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2">
				<input
					type="text"
					className="h-8 min-w-[200px] flex-1 border-b-[2px] border-sys-outline bg-transparent px-2 font-mono text-[0.875rem] font-bold placeholder:opacity-40 focus:border-sys-primary focus:outline-none transition-none"
					placeholder="SEARCH PROMPTS, MODELS, EVENTS..."
					disabled
				/>
				<button className="px-3 py-1.5 text-[0.875rem] font-bold uppercase tracking-[0.05em] bg-transparent text-sys-outline outline outline-[1px] outline-sys-outline hover:bg-sys-surface-low hover:text-sys-on-surface transition-none cursor-not-allowed">
					SEARCH
				</button>
				<select
					className="h-8 bg-transparent text-[0.875rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface border-b-[2px] border-sys-outline focus:outline-none focus:border-sys-primary transition-none cursor-pointer"
					value={hours}
					onChange={(e) => setHours(e.target.value)}
				>
					<option value="1">LAST 1H</option>
					<option value="6">LAST 6H</option>
					<option value="24">LAST 24H</option>
					<option value="72">LAST 72H</option>
				</select>
				<button
					className="px-3 py-1.5 text-[0.875rem] font-bold uppercase tracking-[0.05em] bg-sys-primary text-white hover:bg-micro-gradient transition-none cursor-pointer"
					onClick={loadAll}
				>
					REFRESH
				</button>
			</div>

			{overview && (
				<div className="mb-2 grid grid-cols-4 gap-2">
					<div className="flex flex-col justify-center bg-sys-surface px-3 py-2">
						<div className="m-0 mb-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">TOTAL CALLS</div>
						<div className="m-0 font-mono text-3xl font-light tracking-tight">{overview.summary.totalCalls}</div>
					</div>
					<div className="flex flex-col justify-center bg-sys-surface px-3 py-2">
						<div className="m-0 mb-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">TOTAL COST</div>
						<div className="m-0 font-mono text-3xl font-light tracking-tight">${overview.summary.totalCostUsd?.toFixed(4) || "0.0000"}</div>
					</div>
					<div className="flex flex-col justify-center bg-sys-surface px-3 py-2">
						<div className="m-0 mb-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">TOKENS (P/C)</div>
						<div className="m-0 font-mono text-3xl font-light tracking-tight">{overview.summary.totalPromptTokens || 0} / {overview.summary.totalCompletionTokens || 0}</div>
					</div>
					<div className="flex flex-col justify-center bg-sys-surface px-3 py-2 border-l-[4px] border-sys-error">
						<div className="m-0 mb-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">ERRORS</div>
						<div className="m-0 font-mono text-3xl font-light tracking-tight text-sys-error">{overview.summary.errorCalls}</div>
					</div>
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto bg-sys-surface p-3">
                <div className="mb-2 text-[0.875rem] font-bold uppercase tracking-[0.05em]">
					AI CALLS
				</div>
                <div className="flex flex-col">
				{overview?.calls.map((call) => (
					<div key={call.callId} className="border-b-[1px] border-sys-surface-low p-2 font-mono text-[0.75rem]">
						<div className="flex justify-between items-center mb-2">
							<div className="flex items-center gap-3">
								<span className={`px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${call.isError ? 'bg-sys-error text-white' : 'bg-sys-primary text-white'}`}>
									{call.callType}
								</span>
								<span className="font-bold opacity-100">{call.modelName}</span>
								<span className="opacity-60">({call.provider})</span>
							</div>
							<span className="opacity-60 font-mono text-[0.75rem]">{new Date(call.occurredAt).toLocaleString()}</span>
						</div>

						<div className="grid grid-cols-2 gap-2">
							<div>
								<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70 mb-2">PROMPT</div>
								<div className="bg-sys-surface-low p-2 text-sys-on-surface h-[120px] overflow-y-auto leading-relaxed border-l-[4px] border-sys-outline">
									{call.requestJson}
								</div>
							</div>
							<div>
								<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70 mb-2">RESPONSE</div>
								<div className={`bg-sys-surface-low p-2 h-[120px] overflow-y-auto leading-relaxed border-l-[4px] ${call.isError ? 'border-sys-error text-sys-error' : 'border-sys-primary text-sys-on-surface'}`}>
									{call.isError ? (
										<span className="font-bold">{call.errorMessage}</span>
									) : call.callType === 'prompt_to_image' && call.responseJson?.includes('url') ? (
										<span className="italic opacity-60">IMAGE GENERATED [URL HIDDEN]</span>
									) : (
										call.responseJson
									)}
								</div>
							</div>
						</div>
					</div>
				))}
                </div>
				{overview?.calls.length === 0 && (
					<p className="py-2 text-[0.875rem] opacity-60 uppercase tracking-[0.05em] font-bold">No AI calls found.</p>
				)}
			</div>
		</div>
	);
}
