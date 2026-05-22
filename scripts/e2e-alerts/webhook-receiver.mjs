#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
// Tiny webhook receiver for E2E alert testing.
// Listens on PORT (default 9998), appends every POST body (JSON) as a new
// line in LOG_PATH (default /tmp/obs-e2e/webhook.log), and responds 200 OK.
import { createServer } from "node:http";
import { dirname } from "node:path";

const PORT = Number(process.env.PORT || 9998);
const LOG_PATH = process.env.LOG_PATH || "/tmp/obs-e2e/webhook.log";

mkdirSync(dirname(LOG_PATH), { recursive: true });

writeFileSync(LOG_PATH, ""); // reset on each run

const server = createServer((req, res) => {
	if (req.method !== "POST") {
		res.writeHead(405).end();
		return;
	}
	let body = "";
	req.on("data", (chunk) => {
		body += chunk;
	});
	req.on("end", () => {
		const record = JSON.stringify({
			at: new Date().toISOString(),
			path: req.url,
			headers: Object.fromEntries(
				Object.entries(req.headers).filter(
					([k]) => !k.startsWith("x-forwarded"),
				),
			),
			body: (() => {
				try {
					return JSON.parse(body);
				} catch {
					return body;
				}
			})(),
		});
		appendFileSync(LOG_PATH, record + "\n");
		console.log(`[webhook] ${req.method} ${req.url} → 200 (logged)`);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end('{"ok":true}');
	});
});

server.listen(PORT, () => {
	console.log(`[webhook] listening on :${PORT}, logging to ${LOG_PATH}`);
});
