export type NavItem = { key: string; label: string; short: string };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
	{
		label: "Observe",
		items: [
			{ key: "health", label: "Health", short: "HE" },
			{ key: "timeline", label: "Timeline", short: "TL" },
			{ key: "service-map", label: "Service Map", short: "SM" },
			{ key: "logs", label: "Logs", short: "LG" },
		],
	},
	{
		label: "Investigate",
		items: [
			{ key: "investigate", label: "Investigations", short: "IV" },
			{ key: "traces", label: "Traces", short: "TR" },
			{ key: "issues", label: "Issues", short: "IS" },
			{ key: "ai", label: "AI Calls", short: "AI" },
		],
	},
	{
		label: "Experience",
		items: [{ key: "replay", label: "Replays", short: "RP" }],
	},
	{
		label: "Operate",
		items: [
			{ key: "alerts", label: "Alerts", short: "AL" },
			{ key: "usage", label: "Usage", short: "US" },
			{ key: "resources", label: "Resources", short: "RS" },
			{ key: "tool-reliability", label: "Tool Reliability", short: "TR" },
			{ key: "cost-attribution", label: "Cost Attribution", short: "CA" },
			{ key: "autonomous-review", label: "Autonomous Review", short: "AR" },
			{ key: "agent-version-diff", label: "Version Diff", short: "VD" },
		],
	},
];

export const PINNED_ITEMS: NavItem[] = [
	{ key: "projects", label: "Projects", short: "PR" },
	{ key: "playground", label: "Playground", short: "PG" },
];
