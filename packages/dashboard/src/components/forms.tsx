import type {
	InputHTMLAttributes,
	ReactNode,
	SelectHTMLAttributes,
} from "react";

/**
 * Bottom-line input — the toolbar search style: 2px primary border on
 * focus, transparent background, no surrounding box. Used in dashboard
 * toolbars (Traces / Logs / Usage / etc).
 */
export function Input({
	className = "",
	...rest
}: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			{...rest}
			className={`h-8 border-b-[2px] border-sys-outline bg-transparent px-2 text-[0.8125rem] text-sys-on-surface placeholder:text-sys-on-surface-subtle focus:border-sys-primary focus:outline-none transition-none disabled:cursor-not-allowed disabled:bg-sys-surface-low/30 disabled:opacity-60 ${className}`}
		/>
	);
}

/**
 * Boxed input — the form-field style: 1px outline on all sides, used
 * inside settings forms and modals (AlertRuleForm, ProjectsDashboard
 * create flow, ProjectKeysModal).
 */
export function TextField({
	mono,
	className = "",
	...rest
}: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
	return (
		<input
			{...rest}
			className={`bg-sys-bg px-2 py-1 text-[0.8125rem] text-sys-on-surface outline outline-1 outline-sys-outline focus:outline-sys-primary focus:outline-1 focus:outline-2 transition-none ${
				mono ? "font-mono" : ""
			} disabled:cursor-not-allowed disabled:bg-sys-surface-low/30 disabled:opacity-60 ${className}`}
		/>
	);
}

/**
 * Toolbar-style select — bottom-border, sentence case. Replaces the
 * per-dashboard `Sel` clones (Telemetry, Logs, Usage, ServiceMap each
 * had their own copy).
 */
export function Select({
	options,
	className = "",
	...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
	options: Array<[value: string, label: string]>;
}) {
	return (
		<select
			{...rest}
			className={`h-8 bg-transparent text-[0.8125rem] font-medium text-sys-on-surface border-b-[2px] border-sys-outline focus:outline-none focus:border-sys-primary transition-none cursor-pointer disabled:cursor-not-allowed disabled:bg-sys-surface-low/30 disabled:opacity-60 ${className}`}
		>
			{options.map(([v, l]) => (
				<option key={v} value={v}>
					{l}
				</option>
			))}
		</select>
	);
}

/**
 * Boxed select — form-field style for use inside AlertRuleForm and
 * similar settings UIs.
 */
export function SelectField({
	options,
	mono,
	className = "",
	...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
	options: Array<[value: string, label: string]>;
	mono?: boolean;
}) {
	return (
		<select
			{...rest}
			className={`bg-sys-bg px-2 py-1 text-[0.8125rem] text-sys-on-surface outline outline-1 outline-sys-outline focus:outline-sys-primary focus:outline-2 transition-none cursor-pointer ${
				mono ? "font-mono" : ""
			} disabled:cursor-not-allowed disabled:bg-sys-surface-low/30 disabled:opacity-60 ${className}`}
		>
			{options.map(([v, l]) => (
				<option key={v} value={v}>
					{l}
				</option>
			))}
		</select>
	);
}

/**
 * Form field wrapper: 10px UPPERCASE label tag above the control.
 * Use inside AlertRuleForm / ProjectsDashboard / ProjectKeysModal.
 */
export function Field({
	label,
	htmlFor,
	children,
	className = "",
}: {
	label: string;
	htmlFor?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={`flex flex-col gap-1 ${className}`}>
			<label
				htmlFor={htmlFor}
				className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle"
			>
				{label}
			</label>
			{children}
		</div>
	);
}
