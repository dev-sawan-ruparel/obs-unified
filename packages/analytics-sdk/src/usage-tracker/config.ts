// ── Public config ──

/**
 * Privacy-related rrweb replay options exposed to SDK consumers.
 *
 * The SDK ships safe defaults: all inputs masked, password/email/tel
 * masked specifically, text input values asterisk-padded. Override these
 * to tighten or loosen recording for your app — for example,
 * `maskInputOptions: { text: true }` to also mask plain text inputs, or
 * `blockSelector: ".secret"` to exclude marked subtrees entirely.
 *
 * Fields are forwarded to rrweb's `record()` and merged with the SDK's
 * defaults. Defining a self-contained shape (rather than re-exporting
 * rrweb's `recordOptions`) keeps the SDK's public surface stable across
 * rrweb upgrades.
 */
export interface ReplayPrivacyOptions {
	/** Mask the value of all <input> elements. Default: true. */
	maskAllInputs?: boolean;
	/**
	 * Per-input-type masking. Shallow-merged with SDK defaults
	 * (`{ password: true, email: true, tel: true, text: false }`).
	 */
	maskInputOptions?: Record<string, boolean>;
	/** Function used to mask input values. Default: asterisk-pads up to 20 chars. */
	maskInputFn?: (text: string, element?: HTMLElement | null) => string;
	/** CSS selector matching elements whose text content should be masked. */
	maskTextSelector?: string;
	/** Function used to mask text content. */
	maskTextFn?: (text: string, element?: HTMLElement | null) => string;
	/** CSS selector matching elements to entirely block from recording. */
	blockSelector?: string;
	/** CSS selector matching elements to ignore (rendered but not recorded). */
	ignoreSelector?: string;
}

export interface UsageTrackerConfig {
	/** URL of your collector (e.g. "https://obs.my-app.com"). When set, the SDK sends directly to the collector. */
	collectorUrl?: string;
	/** Write-only API key for the collector. Required when using collectorUrl. */
	apiKey?: string;
	/**
	 * Legacy: endpoint for usage events (e.g. "/api/usage/events").
	 * @deprecated Use collectorUrl + apiKey instead for direct-to-collector mode.
	 */
	endpoint?: string;
	debug?: boolean;
	/** Optional secondary endpoint for error reporting */
	errorEndpoint?: string;
	/** Storage key prefix (default: 'usage') */
	storagePrefix?: string;
	/** Include credentials in fetch */
	credentials?: RequestCredentials;
	/** Error filter: return false to skip reporting an error */
	errorFilter?: (error: {
		name?: string;
		message?: string;
		source?: string;
	}) => boolean;
	/** Max string length for metadata values (default: 160) */
	maxMetadataLength?: number;
	/**
	 * Privacy-related rrweb replay options. Merged with the SDK's safe
	 * defaults — consumers can tighten masking (e.g. mask text inputs too)
	 * or add `blockSelector` / `ignoreSelector` rules without forking the
	 * SDK. See {@link ReplayPrivacyOptions}.
	 */
	replayPrivacyOptions?: ReplayPrivacyOptions;
}
