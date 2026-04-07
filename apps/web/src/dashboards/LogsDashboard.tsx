import { useCallback, useEffect, useState } from "react";
import type { LogsOverviewResponse } from "@obs/types";

export function LogsDashboard() {
	const [overview, setOverview] = useState<LogsOverviewResponse | null>(null);
	const [hours, setHours] = useState("24");
	const [loading, setLoading] = useState(false);

	const loadAll = useCallback(async () => {
		setLoading(true);
		try {
			const r = await fetch(`/api/admin/telemetry/logs?hours=${hours}`);
			if (!r.ok) throw new Error(`${r.status}`);
			const data = await r.json();
			setOverview(data as LogsOverviewResponse);
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

			{loading && !overview && <p className="text-xs text-stone-500">Loading logs...</p>}

			<div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-stone-200 bg-white">
				{overview?.logs.map((log) => (
					<div key={log.logId} className="border-b border-stone-100 p-2 font-mono text-xs flex items-start gap-2">
						<span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${log.severity === 'ERROR' || log.severity === 'FATAL' ? 'bg-red-100 text-red-700' : log.severity === 'WARN' ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-600'}`}>
							{log.severity}
						</span>
						<div className="flex-1 min-w-0">
							<div className="flex justify-between items-center mb-0.5">
								<span className="font-semibold text-stone-900">{log.loggerName || 'unknown'}</span>
								<span className="text-stone-400 text-[10px]">{new Date(log.occurredAt).toLocaleString()}</span>
							</div>
							<p className="text-stone-700 whitespace-pre-wrap">{log.message}</p>
							{log.attributesJson && log.attributesJson !== "{}" && (
								<pre className="mt-1 text-[10px] text-stone-500 bg-stone-50 p-1 rounded overflow-x-auto">
									{JSON.stringify(JSON.parse(log.attributesJson), null, 2)}
								</pre>
							)}
						</div>
					</div>
				))}
				{overview?.logs.length === 0 && (
					<p className="p-4 text-xs text-stone-500">No logs found in this time window.</p>
				)}
			</div>
		</div>
	);
}
