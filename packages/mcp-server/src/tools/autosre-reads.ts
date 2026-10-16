import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { IncidentStatusSchema } from "@obsunified/types";
import { z } from "zod";
import type { CollectorClient } from "../index";

interface ToolOutput {
	[key: string]: unknown;
	isError?: boolean;
	content: Array<{ type: "text"; text: string }>;
}

export interface AutosreReadHelpers {
	toolResult: (
		tool: string,
		params: Record<string, unknown>,
		returns: string,
		data: unknown,
	) => ToolOutput;
	errorToolResult: (error: unknown) => ToolOutput;
}

/**
 * Always-registered AutoSRE incident and remediation read tools. They only
 * call GET routes and never return a grant token (the collector stores only
 * its hash).
 */
export function registerAutosreReadTools(
	server: McpServer,
	client: CollectorClient,
	{ toolResult, errorToolResult }: AutosreReadHelpers,
): void {
	server.registerTool(
		"list_incidents",
		{
			description:
				"List AutoSRE incidents, newest first, optionally filtered by environment and status.",
			inputSchema: {
				environment: z.string().optional(),
				status: IncidentStatusSchema.optional(),
				limit: z.number().int().min(1).max(200).optional().default(50),
			},
		},
		async ({ environment, status, limit }) => {
			try {
				const data = await client.get("/internal/incidents", {
					environment,
					status,
					limit,
				});
				return toolResult(
					"list_incidents",
					{ environment, status, limit },
					"{ data: { incidents: IncidentInvestigation[] }, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardRouteLink({ tab: "incidents" }),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_incident",
		{
			description:
				"Fetch one AutoSRE incident with its recorded findings and remediation proposals (summary, up to 20 each).",
			inputSchema: {
				id: z.string().min(1),
				environment: z.string().optional(),
			},
		},
		async ({ id, environment }) => {
			try {
				const data = await client.get(
					`/internal/incidents/${encodeURIComponent(id)}`,
					{ environment },
				);
				return toolResult(
					"get_incident",
					{ id, environment },
					"{ data: { incident: IncidentInvestigation, findings: InvestigationFinding[], proposals: RemediationProposal[] }, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardRouteLink({
							tab: "incidents",
							incidentId: id,
						}),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_remediation_proposal",
		{
			description:
				"Fetch one remediation proposal: status, effective autonomy, policy reason and (host only) any stored grant callback. The one-time grant token is never returned.",
			inputSchema: {
				id: z.string().min(1),
				environment: z.string().optional(),
			},
		},
		async ({ id, environment }) => {
			try {
				const data = await client.get(
					`/internal/remediations/${encodeURIComponent(id)}`,
					{ environment },
				);
				return toolResult(
					"get_remediation_proposal",
					{ id, environment },
					"{ data: { proposal: RemediationProposal }, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardRouteLink({
							tab: "remediations",
							remediationId: id,
						}),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);
}
