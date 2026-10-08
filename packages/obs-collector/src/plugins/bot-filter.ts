import type {
	CollectorPlugin,
	UsageEventProcessorPlugin,
} from "../framework/collector";
import { isBot } from "../lib/ua-parser";

const processor: UsageEventProcessorPlugin = {
	name: "bot-filter",
	process(events) {
		return events.map((event) => ({ ...event, isBot: isBot(event.userAgent) }));
	},
};

export const botFilterPlugin: CollectorPlugin = {
	name: "bot-filter",
	register(_app, runtime) {
		runtime.addUsageEventProcessor(processor);
	},
};
