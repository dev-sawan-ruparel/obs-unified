import { createContext } from "react";
import type { UsageTracker } from "../usage-tracker";

type AnyHandler<Args extends unknown[] = unknown[], Return = unknown> = (
	...args: Args
) => Return;

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
	/**
	 * RFC 0004 Mode B — wrap a click handler so the interaction_id active
	 * at invocation time stays bound for the handler's full execution
	 * (including async awaits inside the body). Use when a click handler
	 * does deferred or long-running work that Mode A's microtask-scoped
	 * propagation can't reach (setTimeout chains, debounced calls, etc.).
	 *
	 *   <button onClick={withInteraction(async () => {
	 *     await delay(500);
	 *     await fetch("/checkout"); // sees the id
	 *   })} />
	 */
	withInteraction: <F extends AnyHandler>(handler: F) => F;
}

export const AnalyticsContext = createContext<AnalyticsContextValue | null>(
	null,
);
