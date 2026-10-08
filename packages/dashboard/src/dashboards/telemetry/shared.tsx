import type { ReactNode } from "react";

export const fmtTs = (iso: string) => {
	try {
		const d = new Date(iso);
		return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
	} catch {
		return iso;
	}
};

export const copy = (text: string) => {
	void navigator.clipboard.writeText(text);
};

export function Badge({
	children,
	cls,
}: {
	children: ReactNode;
	cls?: string;
}) {
	return (
		<span
			className={`inline-block px-1 py-0 text-[0.625rem] font-bold tracking-[0.05em] uppercase ${cls ?? ""}`}
		>
			{children}
		</span>
	);
}

export function AttrTable({ attrs }: { attrs: [string, unknown][] }) {
	return (
		<div className="bg-sys-bg">
			<table className="w-full text-left">
				<tbody>
					{attrs.map(([k, v]) => (
						<tr
							key={k}
							className="border-b-[1px] border-sys-surface-low last:border-b-0 hover:bg-sys-surface-low transition-none"
						>
							<td className="whitespace-nowrap px-2 py-1.5 align-top font-mono text-[0.75rem] font-bold opacity-70">
								{k}
							</td>
							<td className="break-all px-2 py-1.5 font-mono text-[0.75rem]">
								{String(v).length > 200
									? `${String(v).slice(0, 200)}...`
									: String(v)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
