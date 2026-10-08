#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(
	process.env.OBS_DASHBOARD_DIST ?? "/repo/apps/web/dist",
);
const port = Number(process.env.OBS_DASHBOARD_PORT ?? 5173);
const collector =
	process.env.OBS_COLLECTOR_INTERNAL_URL ?? "http://127.0.0.1:8790";

const proxyPrefixes = ["/auth", "/internal", "/v1"];

createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
		if (proxyPrefixes.some((prefix) => url.pathname.startsWith(prefix))) {
			await proxy(req, res, url);
			return;
		}

		const requested = url.pathname === "/" ? "/index.html" : url.pathname;
		const file = safeJoin(root, decodeURIComponent(requested));
		if (file) {
			try {
				const info = await stat(file);
				if (info.isFile()) {
					res.writeHead(200, { "content-type": contentType(file) });
					createReadStream(file).pipe(res);
					return;
				}
			} catch {
				// Fall through to SPA fallback.
			}
		}

		const index = await readFile(path.join(root, "index.html"));
		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end(index);
	} catch (err) {
		res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
		res.end(err instanceof Error ? err.message : String(err));
	}
}).listen(port, "0.0.0.0", () => {
	console.log(`[obs-unified] dashboard listening on http://0.0.0.0:${port}`);
});

async function proxy(req, res, url) {
	const target = new URL(url.pathname + url.search, collector);
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const item of value) headers.append(key, item);
		} else {
			headers.set(key, value);
		}
	}
	headers.set("host", target.host);

	const upstream = await fetch(target, {
		method: req.method,
		headers,
		body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
		duplex: "half",
	});

	res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
	if (!upstream.body) {
		res.end();
		return;
	}
	for await (const chunk of upstream.body) {
		res.write(chunk);
	}
	res.end();
}

function safeJoin(base, requested) {
	const out = path.resolve(base, `.${requested}`);
	if (out !== base && !out.startsWith(`${base}${path.sep}`)) return null;
	return out;
}

function contentType(file) {
	if (file.endsWith(".html")) return "text/html; charset=utf-8";
	if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
	if (file.endsWith(".css")) return "text/css; charset=utf-8";
	if (file.endsWith(".svg")) return "image/svg+xml";
	if (file.endsWith(".json")) return "application/json; charset=utf-8";
	if (file.endsWith(".png")) return "image/png";
	if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
	if (file.endsWith(".woff2")) return "font/woff2";
	return "application/octet-stream";
}
