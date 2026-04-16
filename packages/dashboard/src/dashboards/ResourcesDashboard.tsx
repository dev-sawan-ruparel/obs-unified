import { useEffect, useState } from "react";
import { useApi } from "../use-api";

interface ResourcesData {
	d1: {
		rowDensity: number;
		eventsCount: number;
		tracesCount: number;
		logsCount: number;
		aiCallsCount: number;
	};
	r2: {
		storageBytes: number;
	};
	worker: {
		cpuMs: number;
		memoryBytes: number;
		requestsCount: number;
		status: string;
	};
}

const fmtBytes = (bytes: number) => {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const fmtNum = (num: number) => new Intl.NumberFormat().format(num);

export function ResourcesDashboard() {
	const api = useApi();
	const [data, setData] = useState<ResourcesData | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		api<{ success: boolean; resources: ResourcesData }>("/platform/resources")
			.then((res) => {
				if (res.success && res.resources) {
					setData(res.resources);
				}
			})
			.catch(console.error)
			.finally(() => setLoading(false));
	}, [api]);

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center font-mono text-[0.875rem] font-bold text-sys-outline">
				ANALYZING TOPOLOGY...
			</div>
		);
	}

	if (!data) {
		return (
			<div className="flex h-full items-center justify-center font-mono text-[0.875rem] font-bold text-sys-error">
				FAILED TO LOAD RESOURCES
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-y-auto">
			<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
				<span className="text-[0.875rem] font-bold tracking-widest text-sys-on-surface">
					PLATFORM RESOURCES
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.875rem] font-mono text-sys-outline uppercase">
					Scale & Integrity
				</span>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-2">
				<div className="bg-sys-surface p-4 border-[1px] border-sys-outline flex flex-col gap-4">
					<div className="flex justify-between items-center">
						<span className="text-[0.875rem] font-bold uppercase tracking-widest text-sys-on-surface">
							DATA STORE (D1)
						</span>
						<span className="text-[0.75rem] px-2 py-1 bg-sys-surface-low border-[1px] border-sys-outline text-sys-on-surface uppercase font-bold">
							SQLITE RELATIONAL
						</span>
					</div>
					<div className="text-[3rem] font-bold font-mono tracking-tighter leading-none pt-4">
						{fmtNum(data.d1.rowDensity)}
					</div>
					<div className="text-[0.875rem] text-sys-outline uppercase font-bold mb-4">
						TOTAL COMBINED ROWS
					</div>

					<div className="flex flex-col gap-2 mt-auto text-[0.875rem] font-mono border-t-[1px] border-sys-outline pt-4">
						<div className="flex justify-between">
							<span className="text-sys-outline">USAGE EVENTS</span>
							<span className="font-bold">{fmtNum(data.d1.eventsCount)}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-sys-outline">TELEMETRY SPANS</span>
							<span className="font-bold">{fmtNum(data.d1.tracesCount)}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-sys-outline">SYSTEM LOGS</span>
							<span className="font-bold">{fmtNum(data.d1.logsCount)}</span>
						</div>
						<div className="flex justify-between">
							<span className="text-sys-outline">AI EXECUTIONS</span>
							<span className="font-bold">{fmtNum(data.d1.aiCallsCount)}</span>
						</div>
					</div>
				</div>

				<div className="bg-sys-surface p-4 border-[1px] border-sys-outline flex flex-col gap-4">
					<div className="flex justify-between items-center">
						<span className="text-[0.875rem] font-bold uppercase tracking-widest text-sys-on-surface">
							BLOB STORAGE (R2)
						</span>
						<span className="text-[0.75rem] px-2 py-1 bg-sys-primary text-white uppercase font-bold">
							OBJECT
						</span>
					</div>
					<div className="text-[3rem] font-bold font-mono tracking-tighter leading-none pt-4">
						{fmtBytes(data.r2.storageBytes)}
					</div>
					<div className="text-[0.875rem] text-sys-outline uppercase font-bold mb-4">
						TOTAL REPLAY FOOTPRINT
					</div>

					<div className="mt-auto pt-4 text-[0.875rem] font-mono text-sys-outline border-t-[1px] border-sys-outline leading-relaxed">
						Object storage operates exclusively as a chunk-sink for Session Replays.
					</div>
				</div>

				<div className="bg-sys-surface p-4 border-[1px] border-sys-outline flex flex-col gap-4">
					<div className="flex justify-between items-center">
						<span className="text-[0.875rem] font-bold uppercase tracking-widest text-sys-on-surface">
							COMPUTE (WORKER)
						</span>
						<span className="text-[0.75rem] px-2 py-1 bg-sys-warning text-sys-bg uppercase font-bold">
							PENDING AUTH
						</span>
					</div>
					<div className="text-[1.5rem] font-bold font-mono tracking-tight leading-tight text-sys-warning pt-4">
						{data.worker.status}
					</div>
					<div className="text-[0.875rem] text-sys-outline uppercase font-bold mb-4">
						GRAPHQL METRICS EXPORTER
					</div>

					<div className="mt-auto pt-4 text-[0.875rem] font-mono text-sys-outline border-t-[1px] border-sys-outline leading-relaxed">
						Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment bindings for live metrics.
					</div>
				</div>
			</div>
		</div>
	);
}
