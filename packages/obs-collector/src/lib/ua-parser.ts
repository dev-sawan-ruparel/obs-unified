const BOT_PATTERN =
	/(?:^|[^\p{L}\p{N}])(?:bot|crawler|spider|slurp|facebookexternalhit|headless|monitoring|uptime|curl|wget|python-requests|go-http-client)(?:$|[^\p{L}\p{N}])/iu;

export interface ParsedUserAgent {
	browser: string | null;
	os: string | null;
	deviceType: string | null;
}

export const isBot = (userAgent: string | null | undefined): boolean =>
	Boolean(userAgent && BOT_PATTERN.test(userAgent));

const detectBrowser = (userAgent: string): string | null => {
	if (/edg\//i.test(userAgent)) return "Edge";
	if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) return "Opera";
	if (/samsungbrowser\//i.test(userAgent)) return "Samsung Internet";
	if (/chrome\//i.test(userAgent) || /crios\//i.test(userAgent))
		return "Chrome";
	if (/firefox\//i.test(userAgent) || /fxios\//i.test(userAgent))
		return "Firefox";
	if (/safari\//i.test(userAgent)) return "Safari";
	return null;
};

const detectOs = (userAgent: string): string | null => {
	if (/windows nt/i.test(userAgent)) return "Windows";
	if (/(iphone|ipad|ipod)/i.test(userAgent)) return "iOS";
	if (/android/i.test(userAgent)) return "Android";
	if (/mac os x/i.test(userAgent) || /macintosh/i.test(userAgent))
		return "macOS";
	if (/linux/i.test(userAgent)) return "Linux";
	return null;
};

const detectDeviceType = (userAgent: string): string | null => {
	if (/ipad|tablet/i.test(userAgent)) return "tablet";
	if (/mobile|iphone|ipod|android/i.test(userAgent)) return "mobile";
	return "desktop";
};

export const parseUserAgent = (
	userAgent: string | null | undefined,
): ParsedUserAgent => {
	if (!userAgent) {
		return { browser: null, os: null, deviceType: null };
	}

	if (isBot(userAgent)) {
		return {
			browser: detectBrowser(userAgent),
			os: detectOs(userAgent),
			deviceType: "bot",
		};
	}

	return {
		browser: detectBrowser(userAgent),
		os: detectOs(userAgent),
		deviceType: detectDeviceType(userAgent),
	};
};
