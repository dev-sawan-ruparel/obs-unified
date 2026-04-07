import type {
	CollectorPlugin,
	UsageEventProcessorPlugin,
} from "../framework/collector";
import { parseJsonRecord } from "../lib/json";

const processor: UsageEventProcessorPlugin = {
	name: "utm-enrichment",
	process(events) {
		return events.map((event) => {
			const properties = parseJsonRecord(event.propertiesJson);
			return {
				...event,
				utmSource:
					(typeof properties.utmSource === "string"
						? properties.utmSource
						: null) || event.utmSource,
				utmMedium:
					(typeof properties.utmMedium === "string"
						? properties.utmMedium
						: null) || event.utmMedium,
				utmCampaign:
					(typeof properties.utmCampaign === "string"
						? properties.utmCampaign
						: null) || event.utmCampaign,
			};
		});
	},
};

export const utmEnrichmentPlugin: CollectorPlugin = {
	name: "utm-enrichment",
	register(_app, runtime) {
		runtime.addUsageEventProcessor(processor);
	},
};
