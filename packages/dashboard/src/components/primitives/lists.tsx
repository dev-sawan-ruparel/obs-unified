import { Card, SectionTitle } from "./layout";

// ── BarList (label + value with proper separation) ──

export function BarList({
	title,
	items,
	color = "var(--color-sys-primary)",
	compact = false,
	selected,
	onToggle,
}: {
	title: string;
	items: Array<[label: string, value: number]>;
	color?: string;
	compact?: boolean;
	selected?: ReadonlySet<string>;
	onToggle?: (label: string) => void;
}) {
	if (items.length === 0) return null;
	const max = Math.max(...items.map(([, v]) => v), 1);
	const rowGap = compact ? "mb-1.5" : "mb-2.5";
	const interactive = typeof onToggle === "function";
	return (
		<Card className="flex flex-col p-3 min-w-0">
			<SectionTitle title={title} />
			<div className="flex flex-col mt-1">
				{items.slice(0, 8).map(([label, value]) => {
					const isSelected = selected?.has(label) ?? false;
					const Row = interactive ? "button" : "div";
					return (
						<Row
							key={label}
							type={interactive ? "button" : undefined}
							onClick={interactive ? () => onToggle?.(label) : undefined}
							aria-pressed={interactive ? isSelected : undefined}
							className={`${rowGap} block w-full text-left ${interactive ? "cursor-pointer hover:bg-sys-surface-low px-1 -mx-1" : ""} ${isSelected ? "bg-sys-surface-high px-1 -mx-1" : ""}`}
						>
							<div className="flex items-baseline justify-between gap-3 mb-1">
								<span
									className={`min-w-0 flex-1 truncate text-[0.75rem] ${isSelected ? "font-bold" : "font-bold"}`}
								>
									{isSelected ? "\u25cf " : ""}
									{label}
								</span>
								<span className="flex-none font-mono text-[0.75rem] opacity-70 tabular-nums">
									{value.toLocaleString()}
								</span>
							</div>
							<div className="h-[3px] w-full bg-sys-surface-low">
								<div
									className="h-full"
									style={{
										width: `${(value / max) * 100}%`,
										backgroundColor: color,
										opacity: isSelected ? 1 : 0.85,
									}}
								/>
							</div>
						</Row>
					);
				})}
			</div>
		</Card>
	);
}
