import { useAnalytics } from "@obsunified/analytics-sdk/react";
import { type ReactNode, useState } from "react";
import {
	FilterGroup,
	FilterPanel,
} from "../../../../packages/dashboard/src/components/FilterPanel";

export function Playground() {
	const {
		trackInteraction,
		identify,
		startReplay,
		fetch: analyticalFetch,
	} = useAnalytics();
	const [response, setResponse] = useState("");
	const [loading, setLoading] = useState(false);
	const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
	const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set());

	const toggleSet = (s: Set<string>, v: string) => {
		const next = new Set(s);
		if (next.has(v)) next.delete(v);
		else next.add(v);
		return next;
	};

	const call = async (path: string, label: string, opts?: RequestInit) => {
		setLoading(true);
		const method = opts?.method || "GET";
		const start = Date.now();
		try {
			const r = await analyticalFetch(path, opts);
			setResponse(JSON.stringify(await r.json(), null, 2));
			trackInteraction(`api_${label}`, {
				path,
				method,
				status: r.status,
				durationMs: Date.now() - start,
			});
		} catch (e) {
			setResponse(`Error: ${e instanceof Error ? e.message : e}`);
			trackInteraction(`api_${label}`, {
				path,
				method,
				status: "error",
				error: String(e),
				durationMs: Date.now() - start,
			});
		} finally {
			setLoading(false);
		}
	};

	const activeFilterCount = statusFilter.size + severityFilter.size;

	return (
		<div className="flex h-full min-h-0">
			<FilterPanel
				storageKey="playground.filters"
				onClear={
					activeFilterCount > 0
						? () => {
								setStatusFilter(new Set());
								setSeverityFilter(new Set());
							}
						: undefined
				}
			>
				<FilterGroup title="Status" count={statusFilter.size}>
					<div className="flex flex-col gap-1">
						{["ok", "error", "timeout", "cancelled"].map((v) => (
							<label
								key={v}
								className="flex cursor-pointer items-center gap-2 text-[0.75rem] text-sys-on-surface-muted hover:text-sys-on-surface"
							>
								<input
									type="checkbox"
									checked={statusFilter.has(v)}
									onChange={() => setStatusFilter((s) => toggleSet(s, v))}
									className="h-3 w-3 accent-sys-primary"
								/>
								<span className="">{v}</span>
							</label>
						))}
					</div>
				</FilterGroup>
				<FilterGroup title="Severity" count={severityFilter.size}>
					<div className="flex flex-col gap-1">
						{["debug", "info", "warn", "error"].map((v) => (
							<label
								key={v}
								className="flex cursor-pointer items-center gap-2 text-[0.75rem] text-sys-on-surface-muted hover:text-sys-on-surface"
							>
								<input
									type="checkbox"
									checked={severityFilter.has(v)}
									onChange={() => setSeverityFilter((s) => toggleSet(s, v))}
									className="h-3 w-3 accent-sys-primary"
								/>
								<span className="">{v}</span>
							</label>
						))}
					</div>
				</FilterGroup>
			</FilterPanel>
			<div className="flex-1 overflow-y-auto p-3">
				<div className="mb-2 flex flex-wrap gap-3">
					<Btn onClick={() => call("/api/health", "health")} disabled={loading}>
						Health
					</Btn>
					<Btn onClick={() => call("/api/items", "items")} disabled={loading}>
						Items
					</Btn>
					<Btn onClick={() => call("/api/items/1", "item1")} disabled={loading}>
						Item 1
					</Btn>
					<Btn
						onClick={() =>
							call("/api/items", "create", {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: '{"name":"W","price":9.99}',
							})
						}
						disabled={loading}
						c="primary"
					>
						Create
					</Btn>
					<div className="w-4" />
					<Btn
						onClick={() => call("/api/items/999", "404")}
						disabled={loading}
						c="warn"
					>
						404
					</Btn>
					<Btn
						onClick={() => call("/api/slow", "slow")}
						disabled={loading}
						c="warn"
					>
						Slow
					</Btn>
					<Btn
						onClick={() => call("/api/error", "err")}
						disabled={loading}
						c="err"
					>
						Error
					</Btn>
					<Btn
						onClick={() => {
							trackInteraction("crash_test", {
								reason: "User triggered hard crash via Playground UI",
							});
							throw new Error("Crash");
						}}
						c="err"
					>
						Crash
					</Btn>
					<div className="w-4" />
					<Btn
						onClick={() => {
							trackInteraction("mock_ai_chat", {
								promptType: "default",
								simulated: true,
							});
							call("/api/chat", "chat", { method: "POST" });
						}}
						disabled={loading}
					>
						Mock AI Chat
					</Btn>
					<div className="w-4" />
					{/* Real LLM demos — each emits typed OpenInference spans that show
				    up under AI CALLS. Require provider keys in apps/obs-demo/.dev.vars. */}
					<Btn
						onClick={() => call("/api/demo/chat", "demo_chat")}
						disabled={loading}
						c="primary"
						title="Fan out one prompt across every enabled LLM provider"
					>
						AI: Chat
					</Btn>
					<Btn
						onClick={() => call("/api/demo/rag", "demo_rag")}
						disabled={loading}
						c="primary"
						title="RETRIEVER → LLM with a fake doc store + rag_faithfulness eval"
					>
						AI: RAG
					</Btn>
					<Btn
						onClick={() => call("/api/demo/tool", "demo_tool")}
						disabled={loading}
						c="primary"
						title="TOOL → LLM weather summary + mentions_temperature eval"
					>
						AI: Tool
					</Btn>
					<Btn
						onClick={() => call("/api/demo/session", "demo_session")}
						disabled={loading}
						c="primary"
						title="Three-turn conversation, all stamped with the same session.id"
					>
						AI: Session
					</Btn>
					<Btn
						onClick={() => call("/api/demo/run-all", "demo_all")}
						disabled={loading}
						c="primary"
						title="Every scenario back-to-back — one-click end-to-end demo"
					>
						AI: Run all
					</Btn>
					<div className="w-4" />
					<Btn
						onClick={() => {
							identify("test-user-123", {
								email: "test@example.com",
								plan: "pro",
							});
							setResponse("Called identify() for test-user-123");
						}}
						disabled={loading}
					>
						Identify User
					</Btn>
					<Btn
						onClick={() => {
							trackInteraction("start_replay_click", { manual: true });
							startReplay();
							setResponse("Started rrweb session replay recording...");
						}}
						disabled={loading}
						c="primary"
					>
						Start Replay
					</Btn>
				</div>
				{response && (
					<pre className="bg-sys-surface p-2 font-mono text-[0.875rem] leading-relaxed text-sys-on-surface max-h-[600px] overflow-auto">
						{response}
					</pre>
				)}
			</div>
		</div>
	);
}

function Btn({
	children,
	onClick,
	disabled,
	c,
	title,
}: {
	children: ReactNode;
	onClick: () => void;
	disabled?: boolean;
	c?: "warn" | "err" | "primary";
	title?: string;
}) {
	const cls =
		c === "err"
			? "bg-sys-error text-white hover:opacity-90"
			: c === "primary"
				? "bg-sys-primary text-white hover:bg-micro-gradient"
				: c === "warn"
					? "bg-transparent text-sys-error shadow-[inset_0_0_0_1px_var(--color-sys-error)] hover:bg-sys-surface-low"
					: "bg-transparent text-sys-on-surface-muted shadow-[inset_0_0_0_1px_var(--color-sys-outline)] hover:bg-sys-surface-low hover:text-sys-on-surface";
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={`px-3 py-1.5 text-[0.875rem] font-semibold transition-none disabled:opacity-40 rounded-none cursor-pointer ${cls}`}
		>
			{children}
		</button>
	);
}
