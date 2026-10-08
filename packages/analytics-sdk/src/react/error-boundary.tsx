import { Component, type ErrorInfo, type ReactNode } from "react";
import { AnalyticsContext, type AnalyticsContextValue } from "./context";

interface AnalyticsErrorBoundaryProps {
	children: ReactNode;
	context?: string;
	fallback?: ReactNode;
}

interface AnalyticsErrorBoundaryState {
	hasError: boolean;
}

export class AnalyticsErrorBoundary extends Component<
	AnalyticsErrorBoundaryProps,
	AnalyticsErrorBoundaryState
> {
	static contextType = AnalyticsContext;
	declare context: AnalyticsContextValue | null;

	state: AnalyticsErrorBoundaryState = { hasError: false };

	static getDerivedStateFromError(): AnalyticsErrorBoundaryState {
		return { hasError: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		const analytics = this.context;
		if (analytics) {
			analytics.trackError(
				error,
				this.props.context ?? info.componentStack?.slice(0, 200),
			);
		}
	}

	render() {
		if (this.state.hasError) {
			return this.props.fallback ?? null;
		}
		return this.props.children;
	}
}
