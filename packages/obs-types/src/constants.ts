export const RETENTION_HOURS = 72;
export const DEFAULT_WINDOW_HOURS = 72;
export const MAX_RETENTION_HOURS = 720; // 30 days max
export const MAX_TRACE_ROWS = 100;
export const MAX_DURATION_SAMPLE_SIZE = 500;
export const MAX_ISSUE_ROWS = 50;
export const MAX_ISSUE_TRACE_ROWS = 20;

export const getConfiguredRetentionHours = (envValue?: string): number => {
	if (!envValue) return RETENTION_HOURS;
	const parsed = Number.parseInt(envValue, 10);
	if (Number.isNaN(parsed) || parsed < 1) return RETENTION_HOURS;
	return Math.min(parsed, MAX_RETENTION_HOURS);
};
