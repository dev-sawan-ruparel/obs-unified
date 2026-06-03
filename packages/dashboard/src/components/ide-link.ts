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
	let path =
		codeRef.absolutePath || codeRef.relativePath || codeRef.originalPath || "";
	if (path.startsWith("file://")) {
		path = path.slice(7);
	}
	let relPath = codeRef.relativePath || "";
	if (relPath.startsWith("file://")) {
		relPath = relPath.slice(7);
	}
	return template
		.replace("{absolutePath}", path)
		.replace("{relativePath}", relPath)
		.replace("{lineNumber}", String(line));
}
