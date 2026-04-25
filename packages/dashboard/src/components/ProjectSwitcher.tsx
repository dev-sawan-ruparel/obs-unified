import { useDashboard } from "../provider";
import { useProjects } from "../hooks/useProjects";

export function ProjectSwitcher() {
	const { projectId, setProjectId } = useDashboard();
	const { projects, loading, error } = useProjects();

	const current = projects.find((p) => p.id === projectId);
	const label = loading
		? "Loading…"
		: error
			? "Project: error"
			: `Project: ${current?.name ?? projectId}`;

	return (
		<div className="relative flex h-8 items-center bg-sys-surface-low text-[0.8125rem] font-medium text-sys-on-surface hover:bg-sys-surface-high">
			<span className="pointer-events-none flex h-full items-center pl-2.5 pr-1">
				{label}
			</span>
			<span aria-hidden className="pointer-events-none pr-2 text-sys-on-surface-subtle">▾</span>
			<select
				value={projectId}
				onChange={(e) => {
					setProjectId(e.target.value);
					// Full reload so all dashboards refetch with the new project.
					// Simpler than plumbing refresh through every hook.
					setTimeout(() => window.location.reload(), 0);
				}}
				disabled={loading || !!error}
				className="absolute inset-0 cursor-pointer opacity-0"
				title={error ? `Failed to load projects: ${error}` : current?.name}
				aria-label="Switch project"
			>
				{loading && <option value={projectId}>Loading…</option>}
				{!loading && projects.length === 0 && (
					<option value="default">default</option>
				)}
				{!loading &&
					projects.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
			</select>
		</div>
	);
}
