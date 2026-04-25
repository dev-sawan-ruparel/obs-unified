import type { IngestKey, IngestKeyWithPlaintext, Project } from "@obs/types";
import { useCallback, useEffect, useState } from "react";
import { useApi } from "../use-api";
import { useDashboard } from "../provider";
import { ProjectKeysModal } from "./ProjectKeysModal";
import { Button } from "../components/Button";
import { Field, TextField } from "../components/forms";
import { Tag } from "../components/Tag";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/states";

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
				<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
					Projects
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] text-sys-on-surface-muted">
					Multi-tenancy & ingest keys
				</span>
				<div className="ml-auto flex gap-2">
					<Button
						variant="primary"
						size="sm"
						onClick={() => setShowCreate(true)}
					>
						+ New project
					</Button>
				</div>
			</div>

			{error && (
				<div className="p-3 bg-sys-error/10 border-l-[4px] border-sys-error mb-2">
					<p className="text-[0.8125rem] font-medium text-sys-error m-0">
						{error}
					</p>
				</div>
			)}

			{showCreate && (
				<div className="mb-2 bg-sys-surface p-4 border-[1px] border-sys-outline flex items-end gap-2">
					<Field label="Name" htmlFor="new-name">
						<TextField
							id="new-name"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
							placeholder="Acme"
						/>
					</Field>
					<Field label="Slug" htmlFor="new-slug">
						<TextField
							id="new-slug"
							value={newSlug}
							mono
							onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
							placeholder="acme"
						/>
					</Field>
					<Button
						variant="primary"
						size="sm"
						onClick={createProject}
						disabled={creating || !newName || !newSlug}
					>
						{creating ? "Creating…" : "Create"}
					</Button>
					<Button size="sm" onClick={() => setShowCreate(false)}>
						Cancel
					</Button>
				</div>
			)}

			<DataTable<Project>
				rows={projects}
				rowKey={(p) => p.id}
				loading={loading}
				emptyState={
					<EmptyState
						title="No projects yet"
						description="The default project is seeded automatically."
					/>
				}
				columns={[
					{
						key: "name",
						header: "Name",
						width: "1fr",
						cell: (p) => <span className="font-semibold">{p.name}</span>,
					},
					{
						key: "slug",
						header: "Slug",
						width: "1fr",
						font: "mono",
						cell: (p) => p.slug,
					},
					{
						key: "created",
						header: "Created",
						width: "1fr",
						font: "mono",
						className: "text-[0.75rem] text-sys-on-surface-muted",
						cell: (p) => new Date(p.createdAt).toLocaleString(),
					},
					{
						key: "active",
						header: "Active",
						width: "auto",
						cell: (p) =>
							p.id === projectId ? (
								<Tag tone="primary">Active</Tag>
							) : (
								<Button
									variant="ghost"
									size="xs"
									onClick={() => {
										setProjectId(p.id);
										setTimeout(() => window.location.reload(), 0);
									}}
								>
									Switch
								</Button>
							),
					},
					{
						key: "actions",
						header: "Actions",
						width: "auto",
						cell: (p) => (
							<Button
								variant="ghost"
								size="xs"
								className="text-sys-primary outline-sys-primary"
								onClick={() => setKeysProject(p)}
							>
								Keys
							</Button>
						),
					},
				]}
			/>

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
