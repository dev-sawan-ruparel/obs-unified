import type { IngestKey, IngestKeyWithPlaintext, Project } from "@obs/types";
import { useCallback, useEffect, useState } from "react";
import { useApi } from "../use-api";

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
						<div className="text-[0.875rem] font-bold tracking-widest text-sys-on-surface">
							INGEST KEYS — {project.name.toUpperCase()}
						</div>
						<div className="text-[0.625rem] font-mono opacity-60 mt-1">
							/projects/{project.slug}
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="px-3 py-1 text-[0.75rem] font-semibold bg-transparent text-sys-on-surface-muted outline outline-1 outline-sys-outline hover:bg-sys-surface-low cursor-pointer"
					>
						Close
					</button>
				</div>

				{justCreated && (
					<div className="mx-4 mt-4 p-3 bg-sys-primary/10 border-l-[4px] border-sys-primary">
						<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] text-sys-primary mb-2">
							NEW KEY — COPY NOW, IT WILL NOT BE SHOWN AGAIN
						</div>
						<div className="flex gap-2 items-center">
							<code className="flex-1 font-mono text-[0.75rem] bg-sys-bg p-2 break-all border-[1px] border-sys-outline">
								{justCreated.key}
							</code>
							<button
								type="button"
								onClick={() => copyToClipboard(justCreated.key)}
								className="px-3 py-1.5 text-[0.75rem] font-semibold bg-sys-primary text-white hover:opacity-90 cursor-pointer"
							>
								{copied ? "Copied" : "Copy"}
							</button>
							<button
								type="button"
								onClick={() => setJustCreated(null)}
								className="px-3 py-1.5 text-[0.75rem] font-semibold bg-transparent text-sys-on-surface-muted outline outline-1 outline-sys-outline hover:bg-sys-surface-low cursor-pointer"
							>
								Dismiss
							</button>
						</div>
					</div>
				)}

				{error && (
					<div className="mx-4 mt-4 p-3 bg-sys-error/10 border-l-[4px] border-sys-error">
						<p className="text-[0.875rem] tracking-[0.05em] font-bold text-sys-error m-0">
							{error}
						</p>
					</div>
				)}

				<div className="p-4">
					<div className="mb-4 flex items-end gap-2">
						<div className="flex flex-col gap-1 flex-1">
							<label
								htmlFor="new-key-name"
								className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60"
							>
								New Key Name
							</label>
							<input
								id="new-key-name"
								value={newKeyName}
								onChange={(e) => setNewKeyName(e.target.value)}
								placeholder="e.g. production-api"
								className="bg-sys-surface px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline"
							/>
						</div>
						<button
							type="button"
							onClick={createKey}
							disabled={creating}
							className="px-3 py-1.5 text-[0.75rem] font-semibold bg-sys-primary text-white hover:opacity-90 cursor-pointer disabled:opacity-40"
						>
							{creating ? "Creating…" : "Create key"}
						</button>
					</div>

					<div className="bg-sys-surface border-[1px] border-sys-outline">
						<div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-3 py-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60 border-b-[1px] border-sys-outline">
							<div>Name</div>
							<div>Prefix</div>
							<div>Created</div>
							<div>Actions</div>
						</div>
						{loading && (
							<div className="px-3 py-4 text-[0.875rem] opacity-60">
								Loading…
							</div>
						)}
						{!loading && keys.length === 0 && (
							<div className="px-3 py-4 text-[0.875rem] opacity-60">
								No keys yet.
							</div>
						)}
						{!loading &&
							keys.map((k) => (
								<div
									key={k.id}
									className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-3 py-2 text-[0.875rem] border-b-[1px] border-sys-outline last:border-b-0 items-center"
								>
									<div
										className={
											k.revokedAt ? "opacity-40 line-through" : "font-bold"
										}
									>
										{k.name}
									</div>
									<div className="font-mono opacity-80 text-[0.75rem]">
										{k.keyPrefix}…
									</div>
									<div className="font-mono opacity-60 text-[0.75rem]">
										{new Date(k.createdAt).toLocaleString()}
									</div>
									<div>
										{k.revokedAt ? (
											<span className="px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.05em] bg-sys-surface-low text-sys-on-surface-muted">
												REVOKED
											</span>
										) : (
											<button
												type="button"
												onClick={() => revokeKey(k.id)}
												className="px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.05em] bg-transparent text-sys-error outline outline-1 outline-sys-error hover:bg-sys-surface-low cursor-pointer"
											>
												REVOKE
											</button>
										)}
									</div>
								</div>
							))}
					</div>

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
