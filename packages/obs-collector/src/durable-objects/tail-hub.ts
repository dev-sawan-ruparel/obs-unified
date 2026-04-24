/**
 * In-memory SSE pub/sub hub for live-tailing spans and logs.
 *
 * Ingest plugins call `/publish` after writing to D1; the dashboard opens an
 * EventSource on `/internal/telemetry/tail` which proxies here via `/subscribe`.
 *
 * One singleton DO instance is used (idFromName("singleton")); it fans out to
 * every connected subscriber, filtering by projectId and kind server-side so
 * clients don't see other tenants' data.
 *
 * Heartbeat frames keep the connection alive through proxies with idle
 * timeouts (Vite dev proxy, Cloudflare edge).
 */

export type TailKind = "span" | "log";

export interface TailEvent {
	kind: TailKind;
	projectId: string;
	row: Record<string, unknown>;
	t: string;
}

interface Subscriber {
	id: string;
	projectId: string;
	kinds: Set<TailKind>;
	writer: WritableStreamDefaultWriter<Uint8Array>;
	heartbeat: ReturnType<typeof setInterval>;
}

const HEARTBEAT_MS = 20_000;

export class TailHub {
	private readonly subscribers = new Map<string, Subscriber>();
	private readonly encoder = new TextEncoder();

	constructor(_state: DurableObjectState, _env: unknown) {}

	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);
		if (req.method === "POST" && url.pathname === "/publish") {
			const events = (await req.json()) as TailEvent[];
			await this.broadcast(events);
			return new Response(null, { status: 204 });
		}
		if (req.method === "GET" && url.pathname === "/subscribe") {
			const projectId = url.searchParams.get("projectId") ?? "default";
			const kindsParam = url.searchParams.get("kinds") ?? "span,log";
			const kinds = new Set(
				kindsParam.split(",").map((s) => s.trim()).filter(Boolean),
			) as Set<TailKind>;
			return this.subscribe(projectId, kinds, req);
		}
		return new Response("not found", { status: 404 });
	}

	private subscribe(
		projectId: string,
		kinds: Set<TailKind>,
		req: Request,
	): Response {
		const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
		const writer = writable.getWriter();
		const id = crypto.randomUUID();

		writer.write(this.encoder.encode(`: connected\n\n`)).catch(() => {});

		const heartbeat = setInterval(() => {
			writer
				.write(this.encoder.encode(`: heartbeat\n\n`))
				.catch(() => this.drop(id));
		}, HEARTBEAT_MS);

		this.subscribers.set(id, { id, projectId, kinds, writer, heartbeat });
		req.signal.addEventListener("abort", () => this.drop(id));

		return new Response(readable, {
			headers: {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				"x-accel-buffering": "no",
			},
		});
	}

	private drop(id: string): void {
		const sub = this.subscribers.get(id);
		if (!sub) return;
		clearInterval(sub.heartbeat);
		sub.writer.close().catch(() => {});
		this.subscribers.delete(id);
	}

	private async broadcast(events: TailEvent[]): Promise<void> {
		if (events.length === 0 || this.subscribers.size === 0) return;
		for (const sub of this.subscribers.values()) {
			const payload = events.filter(
				(e) => e.projectId === sub.projectId && sub.kinds.has(e.kind),
			);
			if (payload.length === 0) continue;
			const frame = this.encoder.encode(
				`event: tail\ndata: ${JSON.stringify(payload)}\n\n`,
			);
			try {
				await sub.writer.write(frame);
			} catch {
				this.drop(sub.id);
			}
		}
	}
}
