import type {
	StoredSpan,
	TelemetryInstrumentationGapsResponse,
	TelemetryIssueDetailResponse,
	TelemetryIssueOptions,
	TelemetryIssueOverviewResponse,
	TelemetryOverviewOptions,
	TelemetryOverviewResponse,
	TelemetryTraceDetailResponse,
} from "@obs-unified/types";
import type { SqlDb } from "./sql-db";
import { getTelemetryExportRows } from "./store/export";
import { ingestTelemetrySpans } from "./store/ingest";
import {
	getTelemetryIssueDetail,
	getTelemetryIssueOverview,
} from "./store/issues";
import { getTelemetryOverview } from "./store/overview";
import { purgeExpiredTelemetry } from "./store/retention";
import {
	getTelemetryServiceMap,
	getTelemetryServiceOperations,
	type ServiceMapOptions,
	type ServiceOperationsOptions,
} from "./store/service-map";
import {
	getTelemetryTraceDetail,
	getTelemetryTraceGaps,
} from "./store/trace-detail";

export class TelemetryStore {
	constructor(private readonly db: SqlDb) {}

	async ingest(
		spans: StoredSpan[],
	): Promise<{ inserted: number; traceCount: number }> {
		return ingestTelemetrySpans(this.db, spans);
	}

	async getOverview(
		options: TelemetryOverviewOptions,
	): Promise<TelemetryOverviewResponse> {
		return getTelemetryOverview(this.db, options);
	}

	async getTraceDetail(
		traceId: string,
		projectId: string,
	): Promise<TelemetryTraceDetailResponse | null> {
		return getTelemetryTraceDetail(this.db, traceId, projectId);
	}

	async getTraceGaps(
		traceId: string,
		projectId: string,
	): Promise<TelemetryInstrumentationGapsResponse | null> {
		return getTelemetryTraceGaps(this.db, traceId, projectId);
	}

	async getIssueOverview(
		options: TelemetryIssueOptions,
	): Promise<TelemetryIssueOverviewResponse> {
		return getTelemetryIssueOverview(this.db, options);
	}

	async getIssueDetail(
		issueId: string,
		options: TelemetryIssueOptions,
	): Promise<TelemetryIssueDetailResponse | null> {
		return getTelemetryIssueDetail(this.db, issueId, options);
	}

	async getExportRows(options: TelemetryOverviewOptions): Promise<string> {
		return getTelemetryExportRows(this.db, options);
	}

	async getServiceMap(options: ServiceMapOptions) {
		return getTelemetryServiceMap(this.db, options);
	}

	async getServiceOperations(options: ServiceOperationsOptions) {
		return getTelemetryServiceOperations(this.db, options);
	}

	async purgeExpired(): Promise<number> {
		return purgeExpiredTelemetry(this.db);
	}
}
