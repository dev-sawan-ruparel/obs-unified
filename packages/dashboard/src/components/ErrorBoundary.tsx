import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";

interface ErrorBoundaryState {
	error: Error | null;
}

export class ErrorBoundary extends Component<
	{ children: ReactNode },
	ErrorBoundaryState
> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[dashboard] render failure", error, info.componentStack);
	}

	render() {
		if (!this.state.error) return this.props.children;

		return (
			<div className="flex min-h-screen items-center justify-center bg-sys-bg p-6 font-sans text-sys-on-surface">
				<div className="w-full max-w-2xl border border-sys-outline bg-sys-surface p-5 shadow-sm">
					<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-error">
						Dashboard render failed
					</div>
					<h1 className="mt-2 text-[1.25rem] font-semibold">
						This panel crashed before it could render.
					</h1>
					<p className="mt-2 text-[0.8125rem] text-sys-on-surface-muted">
						Reload the dashboard to recover, or copy the diagnostic message for
						the failing route.
					</p>
					<pre className="mt-4 max-h-48 overflow-auto bg-sys-bg p-3 font-mono text-[0.75rem] text-sys-on-surface">
						{this.state.error.message}
					</pre>
					<div className="mt-4 flex gap-2">
						<Button
							variant="primary"
							onClick={() => {
								location.reload();
							}}
						>
							Reload dashboard
						</Button>
						<Button
							onClick={() => {
								this.setState({ error: null });
							}}
						>
							Try again
						</Button>
					</div>
				</div>
			</div>
		);
	}
}
