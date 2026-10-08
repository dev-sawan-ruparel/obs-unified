import type { ReactNode } from "react";
import { UpdatedChip } from "../../components/primitives";

export type View = "spans" | "sessions";

// ── Toolbar ────────────────────────────────────────────────────────────────

export function Toolbar({
	view,
	setView,
	children,
	updatedAt,
}: {
	view: View;
	setView: (v: View) => void;
	children?: ReactNode;
	updatedAt?: string | null;
}) {
	return (
		<div className="flex-none flex flex-wrap items-center gap-2 border-b border-sys-outline/40 bg-sys-surface px-3 py-2">
			<div className="flex items-center">
				<ViewTab active={view === "spans"} onClick={() => setView("spans")}>
					Spans
				</ViewTab>
				<ViewTab
					active={view === "sessions"}
					onClick={() => setView("sessions")}
				>
					Sessions
				</ViewTab>
			</div>
			<div className="h-5 w-px bg-sys-outline/40 mx-1" />
			{children}
			<div className="ml-auto" />
			<UpdatedChip at={updatedAt ?? null} />
		</div>
	);
}

function ViewTab({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`px-3 h-7 text-[0.6875rem] font-semibold tracking-[0.08em] cursor-pointer ${
				active
					? "bg-sys-primary text-white"
					: "bg-transparent text-sys-on-surface hover:bg-sys-surface-low"
			}`}
		>
			{children}
		</button>
	);
}
