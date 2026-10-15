/**
 * Dependency ranges written into scaffolded apps. Keep these on the major
 * the workspace publishes (`packages/telemetry-sdk`, `packages/analytics-sdk`);
 * `scaffold-versions.test.ts` fails when they drift behind a release.
 */
export const SCAFFOLD_SDK_RANGES: Record<string, string> = {
	"@obsunified/analytics-sdk": "^2.1.0",
	"@obsunified/telemetry-sdk": "^2.1.0",
};
