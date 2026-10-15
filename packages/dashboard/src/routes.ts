/**
 * Central hash-route builders for AutoSRE entities so components do not
 * hand-assemble `#/findings/...` style strings.
 */
const segment = (id: string): string => encodeURIComponent(id);

export const hashRoutes = {
	change: (id: string): string => `#/changes/${segment(id)}`,
	finding: (id: string): string => `#/findings/${segment(id)}`,
	incident: (id: string): string => `#/incidents/${segment(id)}`,
	remediation: (id: string): string => `#/remediations/${segment(id)}`,
} as const;
