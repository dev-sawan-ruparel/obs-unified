/**
 * Dependency ranges written into scaffolded apps. Keep these on the major
 * the workspace publishes (`packages/telemetry-sdk`, `packages/analytics-sdk`);
 * `scaffold-versions.test.ts` fails when they drift behind a release.
 */
export const SCAFFOLD_SDK_RANGES: Record<string, string> = {
	"@obsunified/analytics-sdk": "^2.1.1",
	"@obsunified/telemetry-sdk": "^2.1.1",
};

export const VALID_SCAFFOLD_TEMPLATES = [
	"react-vite",
	"vanilla-ts",
	"hono-workers",
] as const;

export type ScaffoldTemplate = (typeof VALID_SCAFFOLD_TEMPLATES)[number];

export interface ParsedCreateArgs {
	appName: string | null;
	template?: ScaffoldTemplate;
	collectorUrl?: string;
	yes: boolean;
	error?: string;
}

export function parseCreateArgs(args: string[]): ParsedCreateArgs {
	let appName: string | null = null;
	let template: ScaffoldTemplate | undefined;
	let collectorUrl: string | undefined;
	let yes = false;

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--yes" || arg === "-y") {
			yes = true;
			continue;
		}
		if (arg === "--template" || arg === "-t") {
			const val = args[i + 1];
			if (!val) {
				return {
					appName,
					yes,
					error: `missing value for ${arg} (expected: ${VALID_SCAFFOLD_TEMPLATES.join(", ")})`,
				};
			}
			if (!VALID_SCAFFOLD_TEMPLATES.includes(val as ScaffoldTemplate)) {
				return {
					appName,
					yes,
					error: `invalid template "${val}" (expected: ${VALID_SCAFFOLD_TEMPLATES.join(", ")})`,
				};
			}
			template = val as ScaffoldTemplate;
			i += 1;
			continue;
		}
		if (arg.startsWith("--template=")) {
			const val = arg.slice("--template=".length);
			if (!VALID_SCAFFOLD_TEMPLATES.includes(val as ScaffoldTemplate)) {
				return {
					appName,
					yes,
					error: `invalid template "${val}" (expected: ${VALID_SCAFFOLD_TEMPLATES.join(", ")})`,
				};
			}
			template = val as ScaffoldTemplate;
			continue;
		}
		if (arg === "--collector-url" || arg === "--url" || arg === "-u") {
			const val = args[i + 1];
			if (!val) {
				return { appName, yes, error: `missing value for ${arg}` };
			}
			collectorUrl = val;
			i += 1;
			continue;
		}
		if (arg.startsWith("--collector-url=")) {
			collectorUrl = arg.slice("--collector-url=".length);
			continue;
		}
		if (arg.startsWith("--url=")) {
			collectorUrl = arg.slice("--url=".length);
			continue;
		}
		if (arg.startsWith("-")) {
			return { appName, yes, error: `unknown create option: ${arg}` };
		}
		if (!appName) {
			appName = arg;
		} else {
			return { appName, yes, error: `unexpected argument: ${arg}` };
		}
	}

	return { appName, template, collectorUrl, yes };
}
