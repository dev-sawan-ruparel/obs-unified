// ── UpdatedChip (replaces misleading "CONNECTED") ──

export function UpdatedChip({ at }: { at: string | null }) {
	const text = at ? freshness(at) : "—";
	const fresh = at ? Date.now() - new Date(at).getTime() < 30_000 : false;
	return (
		<div className="flex items-center gap-2 bg-sys-surface-low px-2 py-1">
			<span
				className={`block h-[6px] w-[6px] ${fresh ? "bg-sys-primary" : "bg-sys-outline"}`}
				aria-hidden
			/>
			<span className="text-[0.625rem] font-bold uppercase tracking-[0.1em] opacity-70">
				Updated {text}
			</span>
		</div>
	);
}

function freshness(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	const s = Math.floor(ms / 1000);
	if (s < 5) return "just now";
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}
