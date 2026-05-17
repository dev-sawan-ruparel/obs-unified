/**
 * Storage seam for opaque blob payloads — replay rrweb chunks and
 * pprof profiles.
 *
 * Two implementations:
 *  - `R2BlobStore` — Cloudflare R2 binding (default on Workers).
 *  - `S3BlobStore` (sibling file) — AWS S3 / MinIO / any S3-compatible.
 *
 * Replay chunks live under `replays/<session_id>/<chunk_id>`; pprof
 * profiles live under `profiles/<service>/<trace_id>/<span_id>`. The
 * adapter never sees these paths — they're constructed by the callers
 * (`replay-receiver`, `profile-routes`).
 */

export interface BlobStore {
	put(
		key: string,
		body: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
		options?: BlobPutOptions,
	): Promise<void>;
	get(key: string): Promise<BlobObject | null>;
	delete(key: string): Promise<void>;
	list(prefix: string, options?: BlobListOptions): Promise<BlobListResult>;
}

export interface BlobPutOptions {
	httpMetadata?: { contentType?: string; contentEncoding?: string };
	customMetadata?: Record<string, string>;
}

export interface BlobListOptions {
	limit?: number;
	cursor?: string;
}

export interface BlobObject {
	body: ReadableStream<Uint8Array>;
	bytes(): Promise<Uint8Array>;
	httpMetadata?: { contentType?: string; contentEncoding?: string };
	customMetadata?: Record<string, string>;
}

export interface BlobListResult {
	objects: Array<{ key: string; size: number; uploaded: Date }>;
	cursor?: string;
	truncated: boolean;
}

/**
 * R2 adapter. R2's binding shape is already very close to this
 * interface; the adapter normalizes the differences (cursor type,
 * list pagination shape).
 */
export class R2BlobStore implements BlobStore {
	constructor(private readonly bucket: R2Bucket) {}

	async put(
		key: string,
		body: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
		options?: BlobPutOptions,
	): Promise<void> {
		await this.bucket.put(key, body as ArrayBuffer | ReadableStream, {
			httpMetadata: options?.httpMetadata,
			customMetadata: options?.customMetadata,
		});
	}

	async get(key: string): Promise<BlobObject | null> {
		const obj = await this.bucket.get(key);
		if (!obj) return null;
		return {
			body: obj.body,
			bytes: () => obj.arrayBuffer().then((b) => new Uint8Array(b)),
			httpMetadata: obj.httpMetadata,
			customMetadata: obj.customMetadata,
		};
	}

	async delete(key: string): Promise<void> {
		await this.bucket.delete(key);
	}

	async list(prefix: string, options?: BlobListOptions): Promise<BlobListResult> {
		const r = await this.bucket.list({
			prefix,
			limit: options?.limit,
			cursor: options?.cursor,
		});
		return {
			objects: r.objects.map((o) => ({
				key: o.key,
				size: o.size,
				uploaded: o.uploaded,
			})),
			cursor: r.truncated ? r.cursor : undefined,
			truncated: r.truncated,
		};
	}
}
