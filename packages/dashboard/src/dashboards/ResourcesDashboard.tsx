import { useCallback, useEffect, useState } from "react";
import { useApi } from "../use-api";
import {
	BarList,
	Card,
	SectionTitle,
	Stat,
	UpdatedChip,
} from "../components/primitives";

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
	return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
};

const fmtNum = (num: number) => new Intl.NumberFormat().format(num);

export function ResourcesDashboard() {
	const api = useApi();
	const [data, setData] = useState<ResourcesData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [lastUpdated, setLastUpdated] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await api<{ success: boolean; resources: ResourcesData }>(
				"/platform/resources",
			);
			if (!res.success || !res.resources) {
				throw new Error("collector returned an unexpected shape");
			}
			setData(res.resources);
			setLastUpdated(new Date().toISOString());
		} catch (err) {
			console.error(err);
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [api]);

	useEffect(() => {
		load();
	}, [load]);

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-y-auto">
			<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-3 py-2 border border-[#E5E7E3]">
				<span className="text-[0.875rem] font-bold tracking-widest">
					PLATFORM RESOURCES
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.75rem] font-mono text-sys-on-surface-muted uppercase">
					Scale & integrity · project-scoped
				</span>
				<div className="ml-auto flex items-center gap-2">
					<button
						type="button"
						onClick={load}
						disabled={loading}
						className="px-3 py-1.5 text-[0.75rem] font-bold uppercase tracking-[0.05em] bg-sys-primary text-white hover:bg-micro-gradient transition-none cursor-pointer disabled:opacity-40"
					>
						{loading ? "LOADING…" : "REFRESH"}
					</button>
					<UpdatedChip at={lastUpdated} />
				</div>
			</div>

			{error && (
				<Card accent="error" className="mb-2 p-3">
					<div className="flex items-center gap-3">
						<span className="text-[0.625rem] font-bold uppercase tracking-[0.1em] text-sys-error">
							FAILED TO LOAD
						</span>
						<span className="text-[0.75rem] font-mono opacity-70 break-all">
							{error}
						</span>
						<button
							type="button"
							onClick={load}
							className="ml-auto px-3 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] bg-transparent text-sys-error outline outline-1 outline-sys-error hover:bg-sys-surface-low cursor-pointer"
						>
							RETRY
						</button>
					</div>
				</Card>
			)}

			{loading && !data && !error && (
				<div className="flex h-40 items-center justify-center font-mono text-[0.75rem] font-bold uppercase tracking-[0.1em] text-sys-on-surface-muted">
					ANALYZING TOPOLOGY…
				</div>
			)}

			{data && (
				<>
					{/* Top-level KPIs */}
					<div className="mb-2 grid grid-cols-4 gap-2">
						<Stat
							label="D1 rows (total)"
							value={fmtNum(data.d1.rowDensity)}
							accent="primary"
							footer="spans + logs + usage + ai"
						/>
						<Stat
							label="R2 storage"
							value={fmtBytes(data.r2.storageBytes)}
							accent="accent"
							footer="session replay footprint"
						/>
						<Stat
							label="Worker CPU"
							value={data.worker.cpuMs ? `${data.worker.cpuMs}ms` : "—"}
							accent="warning"
							footer={data.worker.requestsCount ? `${data.worker.requestsCount} reqs` : "pending auth"}
						/>
						<Stat
							label="Worker mem"
							value={data.worker.memoryBytes ? fmtBytes(data.worker.memoryBytes) : "—"}
							footer={data.worker.status.includes("Needs") ? "no token" : "live"}
						/>
					</div>

					<div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
						{/* D1 breakdown */}
						<Card className="flex flex-col gap-3 p-4" accent="primary">
							<div className="flex items-center justify-between">
								<SectionTitle title="Data store (D1)" />
								<span className="text-[0.625rem] px-2 py-0.5 bg-sys-surface-low text-sys-on-surface uppercase font-bold tracking-[0.05em]">
									SQLITE
								</span>
							</div>
							<div className="font-mono text-[2.25rem] font-light leading-none tracking-tight">
								{fmtNum(data.d1.rowDensity)}
							</div>
							<div className="text-[0.625rem] font-bold uppercase tracking-[0.1em] opacity-60">
								Combined rows across 4 signal tables
							</div>
							<div className="mt-auto pt-3 border-t border-[#E5E7E3]">
								<BarList
									title=""
									items={[
										["Usage events", data.d1.eventsCount],
										["Telemetry spans", data.d1.tracesCount],
										["System logs", data.d1.logsCount],
										["AI executions", data.d1.aiCallsCount],
									]}
									compact
								/>
							</div>
						</Card>

						{/* R2 */}
						<Card className="flex flex-col gap-3 p-4" accent="accent">
							<div className="flex items-center justify-between">
								<SectionTitle title="Blob storage (R2)" />
								<span className="text-[0.625rem] px-2 py-0.5 bg-sys-accent text-white uppercase font-bold tracking-[0.05em]">
									OBJECT
								</span>
							</div>
							<div className="font-mono text-[2.25rem] font-light leading-none tracking-tight">
								{fmtBytes(data.r2.storageBytes)}
							</div>
							<div className="text-[0.625rem] font-bold uppercase tracking-[0.1em] opacity-60">
								Session replay footprint
							</div>
							<p className="mt-auto pt-3 border-t border-[#E5E7E3] text-[0.75rem] font-mono opacity-60 leading-relaxed">
								R2 holds rrweb chunks keyed by project + session. D1 tracks
								metadata, R2 holds the frames.
							</p>
						</Card>

						{/* Worker */}
						<Card className="flex flex-col gap-3 p-4" accent="warning">
							<div className="flex items-center justify-between">
								<SectionTitle title="Compute (Worker)" />
								<span className="text-[0.625rem] px-2 py-0.5 bg-sys-warning text-white uppercase font-bold tracking-[0.05em]">
									{data.worker.status.includes("Needs") ? "PENDING AUTH" : "LIVE"}
								</span>
							</div>
							<div className="font-mono text-[1.125rem] font-bold leading-tight tracking-tight text-sys-warning">
								{data.worker.status}
							</div>
							<p className="mt-auto pt-3 border-t border-[#E5E7E3] text-[0.75rem] font-mono opacity-60 leading-relaxed">
								Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to pull
								CPU/memory/request metrics via the GraphQL Analytics API.
							</p>
						</Card>
					</div>
				</>
			)}
		</div>
	);
}
