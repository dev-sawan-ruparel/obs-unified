// ── Supporting Visual Badges ────────────────────────────────────────────────

export function AutonomyBadge({ level }: { level: string }) {
	const normalized = level.toLowerCase();
	let badgeStyle =
		"bg-sys-outline/10 text-sys-on-surface border border-sys-outline/30";

	if (normalized.includes("write") || normalized.includes("autonomous")) {
		// Premium, eye-catching gold gradient representing autonomous power
		badgeStyle =
			"bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-amber-600 border border-amber-500/30 font-semibold";
	} else if (normalized.includes("blocked") || normalized.includes("policy")) {
		badgeStyle =
			"bg-sys-error/15 text-sys-error border border-sys-error/30 font-bold";
	} else if (normalized.includes("read") || normalized.includes("view")) {
		badgeStyle =
			"bg-sys-primary/10 text-sys-primary border border-sys-primary/20";
	}

	return (
		<span
			className={`inline-block px-2 py-0.5 text-[0.55rem] uppercase tracking-wider rounded ${badgeStyle}`}
		>
			{normalized.replace("_", " ")}
		</span>
	);
}

export function ApprovalBadge({ state }: { state: string | null }) {
	if (!state) return null;
	const normalized = state.toLowerCase();
	let badgeStyle =
		"bg-sys-outline/10 text-sys-on-surface border border-sys-outline/20";

	if (normalized.includes("approved")) {
		badgeStyle =
			"bg-sys-primary/15 text-sys-primary border border-sys-primary/30 font-bold";
	} else if (normalized.includes("blocked")) {
		badgeStyle =
			"bg-sys-error/15 text-sys-error border border-sys-error/30 font-bold";
	} else if (normalized.includes("suggested")) {
		badgeStyle =
			"bg-sys-warning/15 text-sys-warning border border-sys-warning/30";
	}

	return (
		<span
			className={`inline-block px-1.5 py-0.2 text-[0.5rem] uppercase tracking-wider rounded ${badgeStyle}`}
		>
			{normalized.replace("_", " ")}
		</span>
	);
}
