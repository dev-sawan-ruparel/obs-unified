import { createContext } from "react";
import type { UsageTracker } from "../usage-tracker";

export interface AnalyticsContextValue {
	tracker: UsageTracker;
	trackInteraction: (
		name: string,
		properties?: Record<string, unknown>,
	) => void;
	trackError: (
		error: Error | { message: string; name?: string; stack?: string },
		context?: string,
	) => void;
	identify: (userId: string, properties?: Record<string, unknown>) => void;
	startReplay: () => void;
	fetch: typeof window.fetch;
}

export const AnalyticsContext = createContext<AnalyticsContextValue | null>(
	null,
);
