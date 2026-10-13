/**
 * Shared handling for batch export responses. `fetch` only rejects on
 * network failure; a 401 from a rotated token or a 503 from an overloaded
 * collector resolves normally, and the exporters used to treat that as
 * success and drop the batch. Transient statuses are requeued so the next
 * flush retries; permanent client errors are dropped loudly rather than
 * re-sent forever.
 */

export const isRetryableExportStatus = (status: number): boolean =>
	status === 408 || status === 429 || status >= 500;

/**
 * Returns `true` when the batch should be requeued. Logs in either case so a
 * misconfigured token or a failing collector is visible in the host's logs.
 */
export const handleExportResponse = (
	what: string,
	response: { ok: boolean; status: number },
	count: number,
): boolean => {
	if (response.ok) return false;
	if (isRetryableExportStatus(response.status)) {
		console.error(
			`[obs-unified] ${what} export failed with HTTP ${response.status}; ${count} item(s) requeued`,
		);
		return true;
	}
	console.error(
		`[obs-unified] ${what} export rejected with HTTP ${response.status}; dropping ${count} item(s)`,
	);
	return false;
};
