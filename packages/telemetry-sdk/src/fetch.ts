/**
 * `fetch` wrapper — emits a `kind=client` HTTP span per outbound call with
 * OTel-shaped attributes. Drop-in for the global `fetch`. No-op outside an
 * active span scope.
 *
 * Conventions follow OTel semantic conventions for HTTP client calls:
 *   http.method                — request method
 *   http.url                   — full URL
 *   server.address / .port     — derived from the URL
 *   http.response.status_code  — set when the response arrives
 *   http.response_content_length — Content-Length when the server returns it
 */

import { withChildSpan } from "./span";

export interface WrapFetchOptions {
	/** Span-name prefix; defaults to `"http"`. Final name is `${prefix}.<method>`. */
	spanNamePrefix?: string;
	/**
	 * Optional URL filter. Returns `false` to bypass tracing for this call —
	 * useful to keep the loop guard out of self-emitted POSTs.
	 */
	skip?: (url: string, init?: RequestInit) => boolean;
}

const safeUrl = (input: RequestInfo | URL): string => {
	try {
		if (typeof input === "string") return input;
		if (input instanceof URL) return input.toString();
		return input.url;
	} catch {
		return "";
	}
};

const safeMethod = (input: RequestInfo | URL, init?: RequestInit): string => {
	if (init?.method) return init.method.toUpperCase();
	if (input instanceof Request) return input.method.toUpperCase();
	return "GET";
};

export const wrapFetch = (
	fn: typeof fetch = fetch,
	opts?: WrapFetchOptions,
): typeof fetch => {
	const prefix = opts?.spanNamePrefix ?? "http";
	const skip = opts?.skip;

	const traced: typeof fetch = async (input, init) => {
		const url = safeUrl(input);
		const method = safeMethod(input, init);
		if (skip?.(url, init)) return fn(input, init);

		return withChildSpan(`${prefix}.${method.toLowerCase()}`, async (span) => {
			span.setAttribute("http.method", method);
			span.setAttribute("http.url", url);
			try {
				const parsed = new URL(url);
				span.setAttribute("server.address", parsed.hostname);
				if (parsed.port) span.setAttribute("server.port", parsed.port);
			} catch {
				// non-absolute URL; skip address attrs
			}
			try {
				const response = await fn(input, init);
				span.setAttribute("http.response.status_code", response.status);
				const contentLength = response.headers.get("content-length");
				const parsedContentLength = contentLength
					? Number.parseInt(contentLength, 10)
					: Number.NaN;
				if (Number.isFinite(parsedContentLength)) {
					span.setAttribute(
						"http.response_content_length",
						parsedContentLength,
					);
				}
				if (response.status >= 400) {
					span.setStatus(2, `HTTP ${response.status}`);
				}
				return response;
			} catch (err) {
				span.setStatus(2, err instanceof Error ? err.message : String(err));
				throw err;
			}
		});
	};

	return traced;
};
