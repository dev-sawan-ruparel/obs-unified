export type LogSeverity = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export interface LogRecord {
	projectId: string;
	logId: string;
	traceId: string | null;
	spanId: string | null;
	serviceName: string | null;
	severity: LogSeverity;
	severityNumber: number;
	loggerName: string | null;
	message: string;
	attributesJson: string | null;
	flags: number;
	droppedAttributesCount: number;
	occurredAt: string;
	receivedAt: string;
	expiresAt: string;
	/** Denormalized from attributes["session.id"] at ingest. */
	sessionId?: string | null;
	/**
	 * RFC 0004 — click-scoped correlation ID. Inherited from the active root
	 * span's interaction_id at log emit time. Null on logs emitted outside a
	 * traced request (cron, queue consumer, server retry).
	 */
	interactionId?: string | null;
}

export interface LogRow {
	project_id: string;
	log_id: string;
	trace_id: string | null;
	span_id: string | null;
	service_name: string | null;
	severity: string;
	severity_number: number;
	logger_name: string | null;
	message: string;
	attributes_json: string | null;
	occurred_at: string;
	received_at: string;
}

export interface LogsOverviewOptions {
	projectId: string;
	hours: number;
	service?: string;
	severity?: LogSeverity;
	traceId?: string;
	limit?: number;
	search?: string;
}

export interface LogsOverviewResponse {
	logs: LogRecord[];
	summary: {
		totalLogs: number;
		errorLogs: number;
		warnLogs: number;
	};
	windowHours: number;
	timestamp: string;
}

// ── AI Call Types ──
