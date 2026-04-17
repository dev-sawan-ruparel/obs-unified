import { useDashboard } from "../provider";
import { useProjects } from "../hooks/useProjects";

export function ProjectSwitcher() {
	const { projectId, setProjectId } = useDashboard();
	const { projects, loading, error } = useProjects();

	const current = projects.find((p) => p.id === projectId);

	return (
		<div className="flex items-center gap-2 mr-4">
			<span className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60">
				Project
			</span>
			<select
				value={projectId}
				onChange={(e) => {
					setProjectId(e.target.value);
					// Full reload so all dashboards refetch with the new project.
					// Simpler than plumbing refresh through every hook.
					setTimeout(() => window.location.reload(), 0);
				}}
				disabled={loading || !!error}
				className="bg-sys-surface text-sys-on-surface text-[0.75rem] font-bold uppercase tracking-[0.05em] px-2 py-1 border-none outline outline-1 outline-sys-outline hover:outline-sys-primary cursor-pointer"
				title={error ? `Failed to load projects: ${error}` : current?.name}
			>
				{loading && <option value={projectId}>LOADING…</option>}
				{!loading &&
					projects.length === 0 && (
						<option value="default">DEFAULT</option>
					)}
				{!loading &&
					projects.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name.toUpperCase()}
						</option>
					))}
			</select>
		</div>
	);
}
