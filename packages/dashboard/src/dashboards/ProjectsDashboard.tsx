import type { IngestKey, IngestKeyWithPlaintext, Project } from "@obs/types";
import { useCallback, useEffect, useState } from "react";
import { useApi } from "../use-api";
import { useDashboard } from "../provider";
import { ProjectKeysModal } from "./ProjectKeysModal";

export function ProjectsDashboard() {
	const api = useApi();
	const { projectId, setProjectId } = useDashboard();
	const [projects, setProjects] = useState<Project[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showCreate, setShowCreate] = useState(false);
	const [newName, setNewName] = useState("");
	const [newSlug, setNewSlug] = useState("");
	const [creating, setCreating] = useState(false);
	const [keysProject, setKeysProject] = useState<Project | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await api<{ projects: Project[] }>("/projects");
			setProjects(data.projects ?? []);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [api]);

	useEffect(() => {
		load();
	}, [load]);

	const createProject = useCallback(async () => {
		if (!newName.trim() || !newSlug.trim()) return;
		setCreating(true);
		setError(null);
		try {
			await api<{ project: Project }>("/projects", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: newName.trim(),
					slug: newSlug.trim().toLowerCase(),
				}),
			});
			setShowCreate(false);
			setNewName("");
			setNewSlug("");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setCreating(false);
		}
	}, [api, newName, newSlug, load]);

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-y-auto">
			<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
				<span className="text-[0.875rem] font-bold tracking-widest text-sys-on-surface">
					PROJECTS
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.875rem] font-mono text-sys-on-surface-muted uppercase">
					Multi-tenancy & ingest keys
				</span>
				<div className="ml-auto flex gap-2">
					<button
						type="button"
						onClick={() => setShowCreate(true)}
						className="px-3 py-1.5 text-[0.75rem] font-bold uppercase tracking-[0.05em] bg-sys-primary text-white hover:opacity-90 cursor-pointer"
					>
						+ NEW PROJECT
					</button>
				</div>
			</div>

			{error && (
				<div className="p-3 bg-sys-error/10 border-l-[4px] border-sys-error mb-2">
					<p className="text-[0.875rem] tracking-[0.05em] font-bold text-sys-error m-0">
						{error}
					</p>
				</div>
			)}

			{showCreate && (
				<div className="mb-2 bg-sys-surface p-4 border-[1px] border-sys-outline flex items-end gap-2">
					<div className="flex flex-col gap-1">
						<label
							htmlFor="new-name"
							className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60"
						>
							Name
						</label>
						<input
							id="new-name"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							placeholder="Acme"
							className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline"
						/>
					</div>
					<div className="flex flex-col gap-1">
						<label
							htmlFor="new-slug"
							className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60"
						>
							Slug
						</label>
						<input
							id="new-slug"
							value={newSlug}
							onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
							placeholder="acme"
							className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline font-mono"
						/>
					</div>
					<button
						type="button"
						onClick={createProject}
						disabled={creating || !newName || !newSlug}
						className="px-3 py-1.5 text-[0.75rem] font-bold uppercase tracking-[0.05em] bg-sys-primary text-white hover:opacity-90 cursor-pointer disabled:opacity-40"
					>
						{creating ? "CREATING…" : "CREATE"}
					</button>
					<button
						type="button"
						onClick={() => setShowCreate(false)}
						className="px-3 py-1.5 text-[0.75rem] font-bold uppercase tracking-[0.05em] bg-transparent text-sys-on-surface-muted outline outline-1 outline-sys-outline hover:bg-sys-surface-low cursor-pointer"
					>
						CANCEL
					</button>
				</div>
			)}

			<div className="bg-sys-surface border-[1px] border-sys-outline">
				<div className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 px-3 py-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60 border-b-[1px] border-sys-outline">
					<div>Name</div>
					<div>Slug</div>
					<div>Created</div>
					<div>Active</div>
					<div>Actions</div>
				</div>
				{loading && (
					<div className="px-3 py-4 text-[0.875rem] opacity-60">LOADING…</div>
				)}
				{!loading && projects.length === 0 && (
					<div className="px-3 py-4 text-[0.875rem] opacity-60">
						No projects yet. The default project is seeded automatically.
					</div>
				)}
				{!loading &&
					projects.map((p) => (
						<div
							key={p.id}
							className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 px-3 py-2 text-[0.875rem] border-b-[1px] border-sys-outline last:border-b-0 items-center"
						>
							<div className="font-bold">{p.name}</div>
							<div className="font-mono opacity-80">{p.slug}</div>
							<div className="font-mono opacity-60 text-[0.75rem]">
								{new Date(p.createdAt).toLocaleString()}
							</div>
							<div>
								{p.id === projectId ? (
									<span className="px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.05em] bg-sys-primary text-white">
										ACTIVE
									</span>
								) : (
									<button
										type="button"
										onClick={() => {
											setProjectId(p.id);
											setTimeout(() => window.location.reload(), 0);
										}}
										className="px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.05em] bg-transparent text-sys-on-surface-muted outline outline-1 outline-sys-outline hover:bg-sys-surface-low cursor-pointer"
									>
										SWITCH
									</button>
								)}
							</div>
							<div>
								<button
									type="button"
									onClick={() => setKeysProject(p)}
									className="px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.05em] bg-transparent text-sys-primary outline outline-1 outline-sys-primary hover:bg-sys-surface-low cursor-pointer"
								>
									KEYS
								</button>
							</div>
						</div>
					))}
			</div>

			{keysProject && (
				<ProjectKeysModal
					project={keysProject}
					onClose={() => setKeysProject(null)}
				/>
			)}
		</div>
	);
}

// Re-export for convenience.
export type { IngestKey, IngestKeyWithPlaintext };
