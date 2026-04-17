import { useCallback, useEffect, useMemo, useState } from "react";
import type { AICallsOverviewResponse } from "@obs/types";
import { useApi } from "../use-api";
import {
	BarList,
	Card,
	SectionTitle,
	Stat,
	TimeSeriesBars,
	UpdatedChip,
	binByInterval,
} from "../components/primitives";

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

	const bucketCount = 24;
	const allBuckets = useMemo(
		() => binByInterval(overview?.calls.map((c) => c.occurredAt) ?? [], Number(hours) * 60, bucketCount),
		[overview, hours],
	);
	const errorBuckets = useMemo(
		() =>
			binByInterval(
				overview?.calls.filter((c) => c.isError).map((c) => c.occurredAt) ?? [],
				Number(hours) * 60,
				bucketCount,
			),
		[overview, hours],
	);

	const byModel = useMemo(() => {
		const map = new Map<string, number>();
		for (const c of overview?.calls ?? []) map.set(c.modelName, (map.get(c.modelName) ?? 0) + 1);
		return Array.from(map.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => [k, v] as [string, number]);
	}, [overview]);

	const byProvider = useMemo(() => {
		const map = new Map<string, number>();
		for (const c of overview?.calls ?? []) map.set(c.provider, (map.get(c.provider) ?? 0) + 1);
		return Array.from(map.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => [k, v] as [string, number]);
	}, [overview]);

	const windowStart = Date.now() - Number(hours) * 60 * 60 * 1000;
	const bucketMs = (Number(hours) * 60 * 60 * 1000) / bucketCount;
	const timeSeries = allBuckets.map((v, i) => ({
		t: new Date(windowStart + i * bucketMs).toISOString(),
		v,
	}));

	const s = overview?.summary;
	const errRate = s && s.totalCalls > 0 ? (s.errorCalls / s.totalCalls) * 100 : 0;

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg font-sans text-sys-on-surface p-2">
			<div className="mb-2 flex-none flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2">
				<input
					type="text"
					className="h-8 min-w-[200px] flex-1 border-b-[2px] border-sys-outline bg-transparent px-2 font-mono text-[0.875rem] font-bold placeholder:opacity-40 focus:border-sys-primary focus:outline-none transition-none"
					placeholder="SEARCH PROMPTS, MODELS, EVENTS..."
					disabled
				/>
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
					type="button"
					className="px-3 py-1.5 text-[0.875rem] font-bold uppercase tracking-[0.05em] bg-sys-primary text-white hover:bg-micro-gradient transition-none cursor-pointer"
					onClick={loadAll}
				>
					REFRESH
				</button>
				<div className="ml-auto">
					<UpdatedChip at={overview?.timestamp ?? null} />
				</div>
			</div>

			{overview && s && (
				<>
					<div className="mb-2 grid grid-cols-5 gap-2">
						<Stat
							label="Calls"
							value={s.totalCalls.toLocaleString()}
							spark={allBuckets}
							note={`${hours}h`}
						/>
						<Stat
							label="Cost (USD)"
							value={`$${(s.totalCostUsd ?? 0).toFixed(4)}`}
							accent="accent"
						/>
						<Stat
							label="Prompt tok."
							value={(s.totalPromptTokens ?? 0).toLocaleString()}
						/>
						<Stat
							label="Compl. tok."
							value={(s.totalCompletionTokens ?? 0).toLocaleString()}
						/>
						<Stat
							label="Errors"
							value={s.errorCalls.toLocaleString()}
							accent={s.errorCalls > 0 ? "error" : "default"}
							spark={errorBuckets}
							footer={s.totalCalls > 0 ? `${errRate.toFixed(1)}% err rate` : undefined}
						/>
					</div>

					<Card className="mb-2 p-3">
						<SectionTitle title="Calls over time" note={`${bucketCount} buckets · ${hours}h`} />
						<TimeSeriesBars data={timeSeries} />
					</Card>

					<div className="mb-2 grid grid-cols-2 gap-2">
						{byModel.length > 0 && (
							<BarList title="By model" items={byModel} color="var(--color-sys-accent)" />
						)}
						{byProvider.length > 0 && <BarList title="By provider" items={byProvider} />}
					</div>
				</>
			)}

			<Card className="min-h-0 flex-1 overflow-y-auto p-3">
				<SectionTitle
					title="AI Calls"
					note={overview ? `${overview.calls.length} in window` : undefined}
				/>
				<div className="flex flex-col mt-1">
					{overview?.calls.map((call) => (
						<div
							key={call.callId}
							className="border-b-[1px] border-sys-surface-low p-2 font-mono text-[0.75rem] last:border-b-0"
						>
							<div className="flex justify-between items-center mb-2">
								<div className="flex items-center gap-3">
									<span
										className={`px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${
											call.isError ? "bg-sys-error text-white" : "bg-sys-primary text-white"
										}`}
									>
										{call.callType}
									</span>
									<span className="font-bold">{call.modelName}</span>
									<span className="opacity-60">({call.provider})</span>
									{call.latencyMs !== null && call.latencyMs !== undefined && (
										<span className="opacity-60 font-mono">{call.latencyMs}ms</span>
									)}
									{call.totalCostUsd !== null && call.totalCostUsd !== undefined && (
										<span className="opacity-60 font-mono">${call.totalCostUsd.toFixed(4)}</span>
									)}
								</div>
								<span className="opacity-60 font-mono text-[0.75rem]">
									{new Date(call.occurredAt).toLocaleString()}
								</span>
							</div>

							<div className="grid grid-cols-2 gap-2">
								<div>
									<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70 mb-2">
										PROMPT
									</div>
									<div className="bg-sys-surface-low p-2 text-sys-on-surface h-[120px] overflow-y-auto leading-relaxed border-l-[3px] border-sys-outline break-all">
										{call.requestJson}
									</div>
								</div>
								<div>
									<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70 mb-2">
										RESPONSE
									</div>
									<div
										className={`bg-sys-surface-low p-2 h-[120px] overflow-y-auto leading-relaxed border-l-[3px] break-all ${
											call.isError
												? "border-sys-error text-sys-error"
												: "border-sys-primary text-sys-on-surface"
										}`}
									>
										{call.isError ? (
											<span className="font-bold">{call.errorMessage}</span>
										) : call.callType === "prompt_to_image" && call.responseJson?.includes("url") ? (
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
					<p className="py-2 text-[0.875rem] opacity-60 uppercase tracking-[0.05em] font-bold">
						No AI calls found.
					</p>
				)}
			</Card>
		</div>
	);
}
