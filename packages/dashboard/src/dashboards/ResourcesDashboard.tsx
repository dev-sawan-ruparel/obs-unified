import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/Button";
import {
	BarList,
	Card,
	SectionTitle,
	Stat,
	UpdatedChip,
} from "../components/primitives";
import { Tag } from "../components/Tag";
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

// RFC 0009 Phase 5.2 — Linux hosts payload from /internal/platform/hosts.
interface HostMetrics {
	host: string;
	metrics: Record<string, number>;
	updatedAt: string;
}

interface MetricExemplar {
	id: string;
	metricName: string;
	serviceName: string | null;
	traceId: string | null;
	spanId: string | null;
	value: number;
	receivedAt: string;
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
	const [hosts, setHosts] = useState<HostMetrics[]>([]);
	const [metricExemplars, setMetricExemplars] = useState<MetricExemplar[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [lastUpdated, setLastUpdated] = useState<string | null>(null);
	const [resourceView, setResourceView] = useState<"cloudflare" | "linux">(
		"cloudflare",
	);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [res, hostsRes, exemplarRes] = await Promise.all([
				api<{ success: boolean; resources: ResourcesData }>(
					"/platform/resources",
				),
				// Linux hosts mode — fail-soft so older collectors and
				// installs without OTel hostmetrics still render the
				// Cloudflare panels.
				api<{ success: boolean; hosts: HostMetrics[] }>(
					"/platform/hosts",
				).catch(() => ({ success: true, hosts: [] as HostMetrics[] })),
				api<{ success: boolean; exemplars: MetricExemplar[] }>(
					"/platform/metric-exemplars?metric_prefix=system.&limit=10",
				).catch(() => ({
					success: true,
					exemplars: [] as MetricExemplar[],
				})),
			]);
			if (!res.success || !res.resources) {
				throw new Error("collector returned an unexpected shape");
			}
			setData(res.resources);
			setHosts(hostsRes.hosts ?? []);
			setMetricExemplars(exemplarRes.exemplars ?? []);
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
				<span className="text-[0.8125rem] font-semibold">
					Platform resources
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] text-sys-on-surface-muted">
					Scale & integrity · project-scoped
				</span>
				<div className="ml-auto flex items-center gap-2">
					<Button variant="primary" size="sm" onClick={load} disabled={loading}>
						{loading ? "Loading…" : "Refresh"}
					</Button>
					<UpdatedChip at={lastUpdated} />
				</div>
			</div>

			{error && (
				<Card accent="error" className="mb-2 p-3">
					<div className="flex items-center gap-3">
						<Tag tone="error">Failed to load</Tag>
						<span className="text-[0.75rem] font-mono text-sys-on-surface-muted break-all">
							{error}
						</span>
						<Button
							size="xs"
							className="ml-auto text-sys-error outline-sys-error"
							onClick={load}
						>
							Retry
						</Button>
					</div>
				</Card>
			)}

			{loading && !data && !error && (
				<div className="flex h-40 items-center justify-center font-mono text-[0.75rem] font-semibold tracking-[0.1em] text-sys-on-surface-muted">
					Analyzing topology…
				</div>
			)}

			{data && (
				<>
					{hosts.length > 0 && (
						<div className="mb-2 flex items-center gap-2 bg-sys-surface px-3 py-2 border border-[#E5E7E3]">
							<span className="text-[0.625rem] uppercase font-bold tracking-[0.05em] opacity-60">
								Resource view
							</span>
							{(["cloudflare", "linux"] as const).map((view) => (
								<button
									key={view}
									type="button"
									onClick={() => setResourceView(view)}
									className={`text-[0.75rem] font-mono px-2 py-1 border-[1px] cursor-pointer transition-none ${
										resourceView === view
											? "bg-sys-primary text-white border-sys-primary"
											: "border-sys-outline hover:bg-sys-surface-high"
									}`}
								>
									{view === "cloudflare" ? "Cloudflare" : "Linux hosts"}
								</button>
							))}
						</div>
					)}
					{/* Top-level KPIs */}
					{resourceView === "cloudflare" && (
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
								footer={
									data.worker.requestsCount
										? `${data.worker.requestsCount} reqs`
										: "pending auth"
								}
							/>
							<Stat
								label="Worker mem"
								value={
									data.worker.memoryBytes
										? fmtBytes(data.worker.memoryBytes)
										: "—"
								}
								footer={
									data.worker.status.includes("Needs") ? "no token" : "live"
								}
							/>
						</div>
					)}

					{resourceView === "cloudflare" && (
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
							{/* D1 breakdown */}
							<Card className="flex flex-col gap-3 p-4" accent="primary">
								<div className="flex items-center justify-between">
									<SectionTitle title="Data store (D1)" />
									<Tag>SQLite</Tag>
								</div>
								<div className="font-mono text-[2.25rem] font-light leading-none tracking-tight">
									{fmtNum(data.d1.rowDensity)}
								</div>
								<div className="text-[0.6875rem] text-sys-on-surface-muted">
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
									<Tag tone="accent">Object</Tag>
								</div>
								<div className="font-mono text-[2.25rem] font-light leading-none tracking-tight">
									{fmtBytes(data.r2.storageBytes)}
								</div>
								<div className="text-[0.6875rem] text-sys-on-surface-muted">
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
									<Tag tone="warning">
										{data.worker.status.includes("Needs")
											? "Pending auth"
											: "Live"}
									</Tag>
								</div>
								<div className="font-mono text-[1.125rem] font-bold leading-tight tracking-tight text-sys-warning">
									{data.worker.status}
								</div>
								<p className="mt-auto pt-3 border-t border-[#E5E7E3] text-[0.75rem] font-mono opacity-60 leading-relaxed">
									Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to
									pull CPU/memory/request metrics via the GraphQL Analytics API.
								</p>
							</Card>
						</div>
					)}

					{/* RFC 0009 Phase 5.2 — Linux hosts mode. Renders only when
					    OTel hostmetrics are flowing in via the receiver. The
					    informative-empty-state lives in docs/howto/ebpf.md. */}
					{resourceView === "linux" && hosts.length > 0 && (
						<div className="mt-2">
							<div className="mb-2 flex items-center gap-3">
								<SectionTitle title="Linux hosts" />
								<Tag>OTel hostmetrics</Tag>
							</div>
							<div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
								{hosts.map((h) => {
									const cpuUtil = h.metrics["system.cpu.utilization"] ?? null;
									const memUsed = h.metrics["system.memory.usage"] ?? null;
									const diskUsed = h.metrics["system.disk.io"] ?? null;
									return (
										<Card key={h.host} className="flex flex-col gap-3 p-4">
											<div className="flex items-center justify-between">
												<SectionTitle title={h.host} />
												<Tag>linux</Tag>
											</div>
											<div className="grid grid-cols-3 gap-2">
												<Stat
													label="CPU"
													value={
														cpuUtil !== null
															? `${(cpuUtil * 100).toFixed(0)}%`
															: "—"
													}
													accent="primary"
												/>
												<Stat
													label="Memory"
													value={memUsed !== null ? fmtBytes(memUsed) : "—"}
													accent="accent"
												/>
												<Stat
													label="Disk I/O"
													value={diskUsed !== null ? fmtBytes(diskUsed) : "—"}
												/>
											</div>
											<div className="mt-auto pt-3 border-t border-[#E5E7E3] text-[0.6875rem] font-mono opacity-60">
												Updated {new Date(h.updatedAt).toLocaleTimeString()}
											</div>
										</Card>
									);
								})}
							</div>
						</div>
					)}

					{metricExemplars.length > 0 && (
						<Card className="mt-2 flex flex-col gap-3 p-4">
							<div className="flex items-center justify-between gap-3">
								<SectionTitle title="Metric exemplars" />
								<Tag tone="accent">trace pivots</Tag>
							</div>
							<div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
								{metricExemplars.map((exemplar) => {
									const href = exemplar.traceId
										? exemplar.spanId
											? `#/traces?trace=${encodeURIComponent(exemplar.traceId)}&span=${encodeURIComponent(exemplar.spanId)}`
											: `#/traces?trace=${encodeURIComponent(exemplar.traceId)}`
										: "";
									return (
										<div
											key={exemplar.id}
											className="border border-sys-outline-soft bg-sys-surface-low p-2 font-mono text-[0.75rem]"
										>
											<div className="flex items-center justify-between gap-2">
												<span className="font-bold truncate">
													{exemplar.metricName}
												</span>
												<span className="tabular-nums opacity-70">
													{exemplar.value}
												</span>
											</div>
											<div className="mt-1 flex items-center justify-between gap-2 text-[0.625rem] opacity-70">
												<span className="truncate">
													{exemplar.serviceName ?? "unknown service"}
												</span>
												<span>
													{new Date(exemplar.receivedAt).toLocaleTimeString()}
												</span>
											</div>
											{href && (
												<a
													href={href}
													className="mt-2 inline-block text-sys-primary underline hover:bg-sys-primary hover:text-white px-1 py-0.5"
												>
													Open trace exemplar
												</a>
											)}
										</div>
									);
								})}
							</div>
						</Card>
					)}
				</>
			)}
		</div>
	);
}
