import type {
	TelemetryIssueDetailResponse,
	TelemetryIssueOverviewResponse,
	TelemetryOverviewResponse,
	TelemetryTraceDetailResponse,
	UsageOverviewResponse,
	UsageSessionDetailResponse,
} from "./types";

/**
 * Union API client config.
 * Uses D's getAuthToken callback pattern (cleaner than per-call token),
 * with configurable base paths.
 */
export interface TelemetryApiClientConfig {
	baseUrl: string;
	getAuthToken: () => string;
	telemetryPath?: string;
	usagePath?: string;
}

export class TelemetryApiClient {
	private readonly baseUrl: string;
	private readonly getAuthToken: () => string;
	private readonly telemetryPath: string;
	private readonly usagePath: string;

	constructor(config: TelemetryApiClientConfig) {
		this.baseUrl = config.baseUrl.replace(/\/$/, "");
		this.getAuthToken = config.getAuthToken;
		this.telemetryPath = config.telemetryPath ?? "/api/admin/telemetry";
		this.usagePath = config.usagePath ?? "/api/admin/usage";
	}

	private buildUrl(
		path: string,
		params?: Record<string, string | number | boolean | undefined>,
	): string {
		const url = `${this.baseUrl}${path}`;
		if (!params) return url;
		const query = Object.entries(params)
			.filter(([, v]) => v !== undefined)
			.map(
				([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
			)
			.join("&");
		return query ? `${url}?${query}` : url;
	}

	private async request<T>(url: string): Promise<T> {
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${this.getAuthToken()}`,
				"Content-Type": "application/json",
			},
		});
		if (!response.ok) {
			throw new Error(`API error: ${response.status} ${response.statusText}`);
		}
		return response.json() as Promise<T>;
	}

	async getTelemetryOverview(
		options: {
			hours?: number;
			service?: string;
			status?: string;
			limit?: number;
			search?: string;
			includeInternal?: boolean;
		} = {},
	): Promise<TelemetryOverviewResponse> {
		return this.request(
			this.buildUrl(this.telemetryPath, {
				hours: options.hours,
				service: options.service,
				status: options.status,
				limit: options.limit,
				q: options.search,
				includeInternal: options.includeInternal,
			}),
		);
	}

	async getTelemetryTrace(
		traceId: string,
	): Promise<TelemetryTraceDetailResponse> {
		return this.request(
			this.buildUrl(
				`${this.telemetryPath}/traces/${encodeURIComponent(traceId)}`,
			),
		);
	}

	async getTelemetryIssues(
		options: {
			hours?: number;
			service?: string;
			category?: string;
			includeInternal?: boolean;
			limit?: number;
		} = {},
	): Promise<TelemetryIssueOverviewResponse> {
		return this.request(
			this.buildUrl(`${this.telemetryPath}/issues`, {
				hours: options.hours,
				service: options.service,
				category: options.category,
				includeInternal: options.includeInternal,
				limit: options.limit,
			}),
		);
	}

	async getTelemetryIssueDetail(
		issueId: string,
		options: {
			hours?: number;
			service?: string;
			category?: string;
			includeInternal?: boolean;
		} = {},
	): Promise<TelemetryIssueDetailResponse> {
		return this.request(
			this.buildUrl(`${this.telemetryPath}/issues/detail`, {
				issueId: encodeURIComponent(issueId),
				hours: options.hours,
				service: options.service,
				category: options.category,
				includeInternal: options.includeInternal,
			}),
		);
	}

	async getUsageOverview(
		options: { hours?: number; path?: string; includeAdmin?: boolean } = {},
	): Promise<UsageOverviewResponse> {
		return this.request(
			this.buildUrl(this.usagePath, {
				hours: options.hours,
				path: options.path,
				includeAdmin: options.includeAdmin,
			}),
		);
	}

	async getUsageSessionDetail(
		sessionId: string,
	): Promise<UsageSessionDetailResponse> {
		return this.request(
			this.buildUrl(
				`${this.usagePath}/sessions/${encodeURIComponent(sessionId)}`,
			),
		);
	}

	async getLogsOverview(
		options: {
			hours?: number;
			service?: string;
			severity?: string;
			traceId?: string;
			limit?: number;
			search?: string;
		} = {},
	): Promise<import("./types").LogsOverviewResponse> {
		return this.request(
			this.buildUrl(`${this.telemetryPath}/logs`, {
				hours: options.hours,
				service: options.service,
				severity: options.severity,
				traceId: options.traceId,
				limit: options.limit,
				search: options.search,
			}),
		);
	}

	async getAICallsOverview(
		options: {
			hours?: number;
			service?: string;
			model?: string;
			isError?: boolean;
			traceId?: string;
			limit?: number;
		} = {},
	): Promise<import("./types").AICallsOverviewResponse> {
		return this.request(
			this.buildUrl(`${this.telemetryPath}/ai`, {
				hours: options.hours,
				service: options.service,
				model: options.model,
				isError: options.isError,
				traceId: options.traceId,
				limit: options.limit,
			}),
		);
	}
}
