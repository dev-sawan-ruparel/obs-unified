export function buildIdeUrl(codeRef: {
	relativePath?: string;
	absolutePath?: string;
	originalPath?: string;
	lineNumber?: number;
}): string {
	const template =
		(typeof import.meta !== "undefined" &&
			import.meta.env &&
			import.meta.env.VITE_IDE_URL_TEMPLATE) ||
		(typeof window !== "undefined" &&
			(window as unknown as Record<string, string>).__IDE_URL_TEMPLATE__) ||
		"vscode://file/{absolutePath}:{lineNumber}";

	const line = codeRef.lineNumber || 1;
	const path =
		codeRef.absolutePath || codeRef.relativePath || codeRef.originalPath || "";
	return template
		.replace("{absolutePath}", path)
		.replace("{relativePath}", codeRef.relativePath || "")
		.replace("{lineNumber}", String(line));
}
