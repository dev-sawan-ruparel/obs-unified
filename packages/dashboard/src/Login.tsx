import { useState } from "react";

export function Login({ onSuccess }: { onSuccess: () => void }) {
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const r = await fetch("/auth/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ password }),
				credentials: "include",
			});

			if (r.ok) {
				onSuccess();
			} else {
				const data = (await r.json().catch(() => ({ error: undefined }))) as {
					error?: string;
				};
				setError(data.error || "Invalid password");
			}
		} catch {
			setError("Connection failed");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="flex h-screen items-center justify-center bg-sys-bg font-sans">
			<form
				onSubmit={handleSubmit}
				className="flex w-[360px] flex-col gap-4 bg-sys-surface p-6 border-[1px] border-sys-outline"
			>
				<div className="text-[0.875rem] font-semibold text-sys-on-surface">
					obs-unified
				</div>
				<div className="text-[0.75rem] text-sys-on-surface-muted">
					Enter dashboard password to continue
				</div>

				<input
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="Password"
					autoFocus
					className="h-10 border-b-[2px] border-sys-outline bg-transparent px-2 font-mono text-[0.875rem] font-bold placeholder:opacity-40 focus:border-sys-primary focus:outline-none transition-none"
				/>

				{error && (
					<div className="text-[0.75rem] font-semibold text-sys-error">
						{error}
					</div>
				)}

				<button
					type="submit"
					disabled={loading || !password}
					className="h-10 bg-sys-primary text-[0.875rem] font-semibold text-white hover:bg-micro-gradient transition-none cursor-pointer disabled:opacity-40"
				>
					{loading ? "Authenticating..." : "Login"}
				</button>
			</form>
		</div>
	);
}
