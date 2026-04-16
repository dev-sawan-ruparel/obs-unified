import { useCallback, useEffect, useState } from "react";
import type { LogsOverviewResponse } from "@obs/types";
import { useApi } from "../use-api";

export function LogsDashboard() {
	const api = useApi();
	const [overview, setOverview] = useState<LogsOverviewResponse | null>(null);
	const [hours, setHours] = useState("24");
	const [loading, setLoading] = useState(false);

	const loadAll = useCallback(async () => {
		setLoading(true);
		try {
			const data = await api<LogsOverviewResponse>(`/logs/overview?hours=${hours}`);
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
					placeholder="SEARCH LOG MESSAGES, ATTRIBUTES..."
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

			{loading && !overview && <p className="p-3 text-[0.875rem] tracking-[0.05em] font-bold opacity-60">INITIALIZING...</p>}

			<div className="min-h-0 flex-1 overflow-y-auto bg-sys-surface p-3">
                <div className="mb-2 text-[0.875rem] font-bold uppercase tracking-[0.05em]">
					LOGS
				</div>
                <div className="flex flex-col">
				{overview?.logs.map((log) => (
					<div key={log.logId} className="border-b-[1px] border-sys-surface-low p-2 font-mono text-[0.75rem] flex items-start gap-2">
						<span className={`px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${log.severity === 'ERROR' || log.severity === 'FATAL' ? 'bg-sys-error text-white' : 'bg-sys-surface-high text-sys-on-surface'}`}>
							{log.severity}
						</span>
						<div className="flex-1 min-w-0">
							<div className="flex justify-between items-center mb-1">
								<span className="font-bold opacity-100">{log.loggerName || 'unknown'}</span>
								<span className="opacity-60">{new Date(log.occurredAt).toLocaleString()}</span>
							</div>
							<p className="opacity-80 whitespace-pre-wrap leading-relaxed m-0">{log.message}</p>
							{log.attributesJson && log.attributesJson !== "{}" && (
								<pre className="mt-2 text-[0.75rem] opacity-70 bg-sys-surface-low p-2 overflow-x-auto">
									{JSON.stringify(JSON.parse(log.attributesJson), null, 2)}
								</pre>
							)}
						</div>
					</div>
				))}
                </div>
				{overview?.logs.length === 0 && (
					<p className="py-2 text-[0.875rem] opacity-60 uppercase tracking-[0.05em] font-bold">No logs found.</p>
				)}
			</div>
		</div>
	);
}
