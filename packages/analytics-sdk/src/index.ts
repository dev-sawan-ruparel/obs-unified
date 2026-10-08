// RFC 0004 — Mode A auto-propagation. The React provider installs this
// automatically when `autoCorrelate` is enabled (default). Exported here
// for non-React hosts that want to wire it up themselves.
export {
	ACTION_HEADER,
	INTERACTION_HEADER,
	type InstallAutoCorrelateOptions,
	installAutoCorrelate,
	ROOT_ACTION_HEADER,
} from "./auto-correlate";
export type {
	InteractionActionContext,
	InteractionContextOptions,
} from "./interaction";
// RFC 0004 — interaction_id primitives. See interaction.ts for usage modes.
export {
	currentActionId,
	currentInteractionContext,
	currentInteractionId,
	currentRootActionId,
	generateInteractionId,
	withInteractionContext,
	withInteractionContextAsync,
	wrapInteraction,
} from "./interaction";
export type {
	ReplayPrivacyOptions,
	UsageTrackerConfig,
} from "./usage-tracker";
export { UsageTracker } from "./usage-tracker";
