import type { ReactNode } from "react";

export type ColumnAlign = "left" | "right" | "center";
export type ColumnFont = "sans" | "mono";

export interface Column<Row> {
	/** Unique key for the column (used as React key and for sort/filter wiring). */
	key: string;
	/** Header label — rendered in the 10px uppercase tag style. */
	header: ReactNode;
	/** Render a cell. Receives the row and the row index. */
	cell: (row: Row, index: number) => ReactNode;
	/** Width: tailwind grid-template-column unit ("1fr", "auto", "120px"). Default "1fr". */
	width?: string;
	/** Text alignment — defaults to left, use "right" for numerics. */
	align?: ColumnAlign;
	/** Font family for cell content. Default "sans". Use "mono" for IDs / numerics. */
	font?: ColumnFont;
	/** Append extra Tailwind classes to every cell in this column. */
	className?: string;
}

/**
 * Data table primitive built on CSS Grid (not <table>) so layouts work
 * with arbitrary column widths and don't require fixed-width cells.
 *
 * One source of truth for the row chrome that used to repeat across
 * AlertsDashboard / ProjectsDashboard / ProjectKeysModal:
 *   - 10px uppercase header row with section-label tag styling
 *   - 13px sentence-case body cells
 *   - Sticky header inside an `overflow-auto` container
 *   - Empty / loading state slots
 *   - Optional row click handler with hover highlight
 *
 * For native `<table>` usage (where you need column-spanning or proper
 * accessibility for screen readers reading tabular data), keep the
 * existing inline implementation — DataTable is for the dense
 * grid-based "list of records" pattern.
 */
export function DataTable<Row>({
	columns,
	rows,
	rowKey,
	loading,
	emptyState,
	onRowClick,
	isRowActive,
	className = "",
}: {
	columns: Column<Row>[];
	rows: Row[];
	rowKey: (row: Row, index: number) => string;
	loading?: boolean;
	emptyState?: ReactNode;
	onRowClick?: (row: Row, index: number) => void;
	isRowActive?: (row: Row, index: number) => boolean;
	className?: string;
}) {
	const template = columns.map((c) => c.width ?? "1fr").join(" ");
	const gridStyle = { gridTemplateColumns: template };

	const alignClass = (a?: ColumnAlign) =>
		a === "right"
			? "text-right justify-end"
			: a === "center"
				? "text-center justify-center"
				: "text-left";

	const fontClass = (f?: ColumnFont) => (f === "mono" ? "font-mono" : "");

	return (
		<div className={`flex flex-col bg-sys-surface border border-sys-outline-soft ${className}`}>
			<div
				className="grid gap-2 px-3 py-2 sticky top-0 bg-sys-surface border-b border-sys-outline-soft"
				style={gridStyle}
			>
				{columns.map((c) => (
					<div
						key={c.key}
						className={`flex items-center text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle ${alignClass(c.align)} ${c.className ?? ""}`}
					>
						{c.header}
					</div>
				))}
			</div>
			<div className="flex flex-col">
				{loading && (
					<div className="px-3 py-3 text-[0.8125rem] text-sys-on-surface-muted">
						Loading…
					</div>
				)}
				{!loading && rows.length === 0 && emptyState}
				{!loading &&
					rows.map((row, i) => {
						const active = isRowActive?.(row, i) ?? false;
						return (
							<div
								key={rowKey(row, i)}
								onClick={onRowClick ? () => onRowClick(row, i) : undefined}
								className={`grid gap-2 px-3 py-2 border-b border-sys-outline-soft last:border-b-0 items-center text-[0.8125rem] ${
									onRowClick ? "cursor-pointer hover:bg-sys-surface-low" : ""
								} ${active ? "bg-sys-surface-low" : ""}`}
								style={gridStyle}
							>
								{columns.map((c) => (
									<div
										key={c.key}
										className={`min-w-0 truncate ${alignClass(c.align)} ${fontClass(c.font)} ${c.className ?? ""}`}
									>
										{c.cell(row, i)}
									</div>
								))}
							</div>
						);
					})}
			</div>
		</div>
	);
}
