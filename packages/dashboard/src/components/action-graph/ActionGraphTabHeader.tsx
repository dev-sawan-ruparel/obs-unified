import type { ActiveActionGraphTab } from "./types";

interface ActionGraphTabHeaderProps {
	activeTab: ActiveActionGraphTab;
	onTabChange: (tab: ActiveActionGraphTab) => void;
}

const tabs: Array<{ id: ActiveActionGraphTab; label: string }> = [
	{ id: "tree", label: "🌳 Causal Action Tree" },
	{ id: "governance", label: "🛡️ Governance & Auditing" },
	{ id: "diff", label: "📊 Prompt Diff & Evals" },
];

export function ActionGraphTabHeader({
	activeTab,
	onTabChange,
}: ActionGraphTabHeaderProps) {
	return (
		<div className="flex-none flex items-center border-b border-sys-outline/30 bg-sys-surface/80 backdrop-blur-md sticky top-0 z-20 px-3">
			{tabs.map((tab) => (
				<button
					key={tab.id}
					type="button"
					onClick={() => onTabChange(tab.id)}
					className={`px-4 py-3 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase border-b-2 transition-all cursor-pointer ${
						activeTab === tab.id
							? "border-sys-primary text-sys-primary"
							: "border-transparent text-sys-on-surface/60 hover:text-sys-on-surface hover:bg-sys-surface-low"
					}`}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}
