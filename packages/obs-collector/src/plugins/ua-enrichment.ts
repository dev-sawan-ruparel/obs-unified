import type {
	CollectorPlugin,
	UsageEventProcessorPlugin,
} from "../framework/collector";
import { parseUserAgent } from "../lib/ua-parser";

const processor: UsageEventProcessorPlugin = {
	name: "ua-enrichment",
	process(events) {
		return events.map((event) => {
			const parsed = parseUserAgent(event.userAgent);
			return {
				...event,
				browser: parsed.browser,
				os: parsed.os,
				deviceType: parsed.deviceType,
			};
		});
	},
};

export const uaEnrichmentPlugin: CollectorPlugin = {
	name: "ua-enrichment",
	register(_app, runtime) {
		runtime.addUsageEventProcessor(processor);
	},
};
