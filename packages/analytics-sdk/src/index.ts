export type { UsageTrackerConfig } from "./usage-tracker";
export { UsageTracker } from "./usage-tracker";

// RFC 0004 — interaction_id primitives. See interaction.ts for usage modes.
export {
	currentInteractionId,
	generateInteractionId,
	withInteractionContext,
	withInteractionContextAsync,
	wrapInteraction,
} from "./interaction";

// RFC 0004 — Mode A auto-propagation. The React provider installs this
// automatically when `autoCorrelate` is enabled (default). Exported here
// for non-React hosts that want to wire it up themselves.
export {
	INTERACTION_HEADER,
	installAutoCorrelate,
	type InstallAutoCorrelateOptions,
} from "./auto-correlate";
