import type { IngestKey, IngestKeyWithPlaintext, Project } from "@obs-unified/types";
import { useCallback, useEffect, useState } from "react";
import { useApi } from "../use-api";
import { Button } from "../components/Button";
import { Field, TextField } from "../components/forms";
import { Tag } from "../components/Tag";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/states";

interface Props {
	project: Project;
	onClose: () => void;
}

export function ProjectKeysModal({ project, onClose }: Props) {
	const api = useApi();
	const [keys, setKeys] = useState<IngestKey[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [newKeyName, setNewKeyName] = useState("");
	const [creating, setCreating] = useState(false);
	const [justCreated, setJustCreated] = useState<IngestKeyWithPlaintext | null>(
		null,
	);
	const [copied, setCopied] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await api<{ keys: IngestKey[] }>(
				`/projects/${project.id}/keys`,
			);
			setKeys(data.keys ?? []);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [api, project.id]);

	useEffect(() => {
		load();
	}, [load]);

	const createKey = useCallback(async () => {
		setCreating(true);
		setError(null);
		try {
			const created = await api<IngestKeyWithPlaintext>(
				`/projects/${project.id}/keys`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: newKeyName.trim() || "unnamed" }),
				},
			);
			setJustCreated(created);
			setNewKeyName("");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setCreating(false);
		}
	}, [api, project.id, newKeyName, load]);

	const revokeKey = useCallback(
		async (keyId: string) => {
			if (!confirm("Revoke this key? Clients using it will start getting 401s within 60 seconds.")) return;
			try {
				await api(`/projects/${project.id}/keys/${keyId}`, { method: "DELETE" });
				await load();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
		[api, project.id, load],
	);

	const copyToClipboard = useCallback(async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// ignore
		}
	}, []);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
			<div className="bg-sys-bg border-[1px] border-sys-outline w-full max-w-[720px] max-h-[90vh] overflow-auto">
				<div className="flex items-center justify-between px-4 py-3 border-b-[1px] border-sys-outline bg-sys-surface">
					<div>
						<div className="text-[0.8125rem] font-semibold text-sys-on-surface">
							Ingest keys · {project.name}
						</div>
						<div className="text-[0.625rem] font-mono text-sys-on-surface-muted mt-1">
							/projects/{project.slug}
						</div>
					</div>
					<Button size="sm" onClick={onClose}>
						Close
					</Button>
				</div>

				{justCreated && (
					<div className="mx-4 mt-4 p-3 bg-sys-primary/10 border-l-[4px] border-sys-primary">
						<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-primary mb-2">
							New key — copy now, it will not be shown again
						</div>
						<div className="flex gap-2 items-center">
							<code className="flex-1 font-mono text-[0.75rem] bg-sys-bg p-2 break-all border-[1px] border-sys-outline">
								{justCreated.key}
							</code>
							<Button
								variant="primary"
								size="sm"
								onClick={() => copyToClipboard(justCreated.key)}
							>
								{copied ? "Copied" : "Copy"}
							</Button>
							<Button size="sm" onClick={() => setJustCreated(null)}>
								Dismiss
							</Button>
						</div>
					</div>
				)}

				{error && (
					<div className="mx-4 mt-4 p-3 bg-sys-error/10 border-l-[4px] border-sys-error">
						<p className="text-[0.8125rem] font-medium text-sys-error m-0">
							{error}
						</p>
					</div>
				)}

				<div className="p-4">
					<div className="mb-4 flex items-end gap-2">
						<Field label="New key name" htmlFor="new-key-name" className="flex-1">
							<TextField
								id="new-key-name"
								value={newKeyName}
								onChange={(e) => setNewKeyName(e.target.value)}
								placeholder="e.g. production-api"
							/>
						</Field>
						<Button
							variant="primary"
							size="sm"
							onClick={createKey}
							disabled={creating}
						>
							{creating ? "Creating…" : "Create key"}
						</Button>
					</div>

					<DataTable<IngestKey>
						rows={keys}
						rowKey={(k) => k.id}
						loading={loading}
						emptyState={<EmptyState title="No keys yet" />}
						columns={[
							{
								key: "name",
								header: "Name",
								width: "1fr",
								cell: (k) => (
									<span
										className={
											k.revokedAt
												? "opacity-40 line-through"
												: "font-semibold"
										}
									>
										{k.name}
									</span>
								),
							},
							{
								key: "prefix",
								header: "Prefix",
								width: "1fr",
								font: "mono",
								className: "text-[0.75rem] text-sys-on-surface-muted",
								cell: (k) => `${k.keyPrefix}…`,
							},
							{
								key: "created",
								header: "Created",
								width: "1fr",
								font: "mono",
								className: "text-[0.75rem] text-sys-on-surface-muted",
								cell: (k) => new Date(k.createdAt).toLocaleString(),
							},
							{
								key: "actions",
								header: "Actions",
								width: "auto",
								cell: (k) =>
									k.revokedAt ? (
										<Tag tone="muted">Revoked</Tag>
									) : (
										<Button
											variant="ghost"
											size="xs"
											className="text-sys-error outline-sys-error"
											onClick={() => revokeKey(k.id)}
										>
											Revoke
										</Button>
									),
							},
						]}
					/>

					<div className="mt-4 text-[0.75rem] font-mono opacity-60 leading-relaxed">
						Key revocation propagates within ~60 seconds due to the in-memory
						cache in the collector. Keys are hashed with SHA-256 before storage;
						the plaintext cannot be recovered.
					</div>
				</div>
			</div>
		</div>
	);
}
