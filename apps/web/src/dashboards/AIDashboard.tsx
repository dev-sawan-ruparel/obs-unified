import { useCallback, useEffect, useState } from "react";
import type { AICallsOverviewResponse } from "@obs/types";

export function AIDashboard() {
	const [overview, setOverview] = useState<AICallsOverviewResponse | null>(null);
	const [hours, setHours] = useState("24");
	const [loading, setLoading] = useState(false);

	const loadAll = useCallback(async () => {
		setLoading(true);
		try {
			const r = await fetch(`/api/admin/telemetry/ai?hours=${hours}`);
			if (!r.ok) throw new Error(`${r.status}`);
			const data = await r.json();
			setOverview(data as AICallsOverviewResponse);
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	}, [hours]);

	useEffect(() => {
		loadAll();
	}, [loadAll]);

	return (
		<div className="flex h-full flex-col overflow-hidden p-3">
			<div className="mb-2 flex-none rounded-md border border-stone-200 bg-white p-2 flex gap-2">
				<select
					className="h-7 rounded border border-stone-300 bg-white px-2 text-xs"
					value={hours}
					onChange={(e) => setHours(e.target.value)}
				>
					<option value="1">Last 1h</option>
					<option value="6">Last 6h</option>
					<option value="24">Last 24h</option>
					<option value="72">Last 72h</option>
				</select>
				<button
					className="h-7 rounded border border-stone-900 bg-stone-900 px-2 text-xs font-medium text-white"
					onClick={loadAll}
				>
					Refresh
				</button>
			</div>

			{overview && (
				<div className="mb-2 grid grid-cols-4 gap-2 text-xs">
					<div className="rounded border bg-white p-2">
						<div className="text-stone-400 mb-1">Total Calls</div>
						<div className="text-lg font-bold">{overview.summary.totalCalls}</div>
					</div>
					<div className="rounded border bg-white p-2">
						<div className="text-stone-400 mb-1">Total Cost</div>
						<div className="text-lg font-bold">${overview.summary.totalCostUsd?.toFixed(4) || "0.0000"}</div>
					</div>
					<div className="rounded border bg-white p-2">
						<div className="text-stone-400 mb-1">Tokens (P / C)</div>
						<div className="text-lg font-bold">{overview.summary.totalPromptTokens || 0} / {overview.summary.totalCompletionTokens || 0}</div>
					</div>
					<div className="rounded border bg-white p-2">
						<div className="text-stone-400 mb-1">Errors</div>
						<div className="text-lg font-bold text-red-600">{overview.summary.errorCalls}</div>
					</div>
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-stone-200 bg-white">
				{overview?.calls.map((call) => (
					<div key={call.callId} className="border-b border-stone-100 p-3 font-mono text-xs">
						<div className="flex justify-between items-center mb-2">
							<div className="flex items-center gap-2">
								<span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${call.isError ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
									{call.callType.toUpperCase()}
								</span>
								<span className="font-semibold">{call.modelName}</span>
								<span className="text-stone-400">({call.provider})</span>
							</div>
							<span className="text-stone-400 text-[10px]">{new Date(call.occurredAt).toLocaleString()}</span>
						</div>
						
						<div className="grid grid-cols-2 gap-4">
							<div>
								<div className="text-[10px] font-semibold text-stone-400 mb-1">PROMPT</div>
								<div className="bg-stone-50 p-2 rounded text-stone-700 h-32 overflow-y-auto">
									{call.requestJson}
								</div>
							</div>
							<div>
								<div className="text-[10px] font-semibold text-stone-400 mb-1">RESPONSE</div>
								<div className="bg-blue-50/50 p-2 rounded text-stone-700 h-32 overflow-y-auto">
									{call.isError ? (
										<span className="text-red-500">{call.errorMessage}</span>
									) : call.callType === 'prompt_to_image' && call.responseJson?.includes('url') ? (
										<span className="text-blue-500 italic">Image generated [url hidden]</span>
									) : (
										call.responseJson
									)}
								</div>
							</div>
						</div>
					</div>
				))}
				{overview?.calls.length === 0 && (
					<p className="p-4 text-xs text-stone-500">No AI calls found in this time window.</p>
				)}
			</div>
		</div>
	);
}
