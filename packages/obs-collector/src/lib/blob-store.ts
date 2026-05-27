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
	/**
	 * Object size in bytes when the store knows it cheaply (S3 `ContentLength`,
	 * R2 `size`). Undefined when it can't be determined without reading the body.
	 */
	size?: number;
	httpMetadata?: { contentType?: string; contentEncoding?: string };
	customMetadata?: Record<string, string>;
}

export interface BlobListResult {
	objects: Array<{ key: string; size: number; uploaded: Date }>;
	cursor?: string;
	truncated: boolean;
}

const toExactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};

const emptyChecksums: R2Checksums = {
	toJSON: () => ({}),
};

const writeMetadata = (
	metadata: R2HTTPMetadata | undefined,
	headers: Headers,
): void => {
	if (!metadata) return;
	if (metadata.contentType) headers.set("content-type", metadata.contentType);
	if (metadata.contentLanguage)
		headers.set("content-language", metadata.contentLanguage);
	if (metadata.contentDisposition)
		headers.set("content-disposition", metadata.contentDisposition);
	if (metadata.contentEncoding)
		headers.set("content-encoding", metadata.contentEncoding);
	if (metadata.cacheControl)
		headers.set("cache-control", metadata.cacheControl);
	if (metadata.cacheExpiry)
		headers.set("expires", metadata.cacheExpiry.toUTCString());
};

const metadataFrom = (
	metadata: R2HTTPMetadata | Headers | undefined,
): R2HTTPMetadata | undefined => {
	if (!metadata) return undefined;
	if (metadata instanceof Headers) {
		return {
			contentType: metadata.get("content-type") ?? undefined,
			contentLanguage: metadata.get("content-language") ?? undefined,
			contentDisposition: metadata.get("content-disposition") ?? undefined,
			contentEncoding: metadata.get("content-encoding") ?? undefined,
			cacheControl: metadata.get("cache-control") ?? undefined,
			cacheExpiry: metadata.get("expires")
				? new Date(metadata.get("expires") as string)
				: undefined,
		};
	}
	return metadata;
};

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
			size: obj.size,
			httpMetadata: obj.httpMetadata,
			customMetadata: obj.customMetadata,
		};
	}

	async delete(key: string): Promise<void> {
		await this.bucket.delete(key);
	}

	async list(
		prefix: string,
		options?: BlobListOptions,
	): Promise<BlobListResult> {
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

export class BlobStoreToR2Adapter implements R2Bucket {
	constructor(private readonly store: BlobStore) {}

	async put(
		key: string,
		value:
			| ReadableStream
			| ArrayBuffer
			| ArrayBufferView
			| string
			| Blob
			| null,
		options?: R2PutOptions,
	): Promise<R2Object> {
		let body: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;
		if (value === null) {
			body = new Uint8Array(0);
		} else if (typeof value === "string") {
			body = new TextEncoder().encode(value);
		} else if (value instanceof ReadableStream) {
			body = value as ReadableStream<Uint8Array>;
		} else if (value instanceof ArrayBuffer) {
			body = value;
		} else if (ArrayBuffer.isView(value)) {
			body = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		} else if (value instanceof Blob) {
			body = new Uint8Array(await value.arrayBuffer());
		} else {
			throw new Error("Unsupported value type for S3 put");
		}

		const size =
			body instanceof ReadableStream
				? 0
				: body instanceof ArrayBuffer
					? body.byteLength
					: body.byteLength;
		const httpMetadata = metadataFrom(options?.httpMetadata);
		await this.store.put(key, body, {
			httpMetadata,
			customMetadata: options?.customMetadata,
		});

		return {
			key,
			version: "",
			size,
			etag: "",
			httpEtag: "",
			checksums: emptyChecksums,
			uploaded: new Date(),
			httpMetadata,
			customMetadata: options?.customMetadata,
			storageClass: options?.storageClass ?? "Standard",
			writeHttpMetadata: (headers: Headers) =>
				writeMetadata(httpMetadata, headers),
		} as unknown as R2Object;
	}

	async get(
		key: string,
		_options?: R2GetOptions,
	): Promise<R2ObjectBody | null> {
		const obj = await this.store.get(key);
		if (!obj) return null;

		// One underlying stream backs both `body` and the buffered accessors.
		// Callers consume exactly one of them — the profile download streams
		// `body` via `new Response(obj.body)`, while replay/profile-filter read
		// `json()`/`arrayBuffer()`. Teeing would force the unread branch to
		// buffer the entire blob in memory (defeating the streaming download for
		// large pprof profiles), so we share a single stream instead. This also
		// keeps `bodyUsed` honest: the buffered accessors lock `body` directly.
		const body = obj.body;
		let bytesPromise: Promise<Uint8Array> | null = null;
		const bytes = async (): Promise<Uint8Array> => {
			if (!bytesPromise) bytesPromise = streamToBytes(body);
			return bytesPromise;
		};
		const httpMetadata = obj.httpMetadata;

		return {
			key,
			version: "",
			size: obj.size ?? 0,
			etag: "",
			httpEtag: "",
			checksums: emptyChecksums,
			uploaded: new Date(),
			httpMetadata,
			customMetadata: obj.customMetadata,
			storageClass: "Standard",
			body,
			get bodyUsed() {
				return body.locked;
			},
			arrayBuffer: async () => {
				const data = await bytes();
				return toExactArrayBuffer(data);
			},
			bytes: async () => {
				const data = await bytes();
				return new Uint8Array(data);
			},
			json: async <T>() => {
				const data = await bytes();
				const text = new TextDecoder().decode(data);
				return JSON.parse(text) as T;
			},
			text: async () => {
				const data = await bytes();
				return new TextDecoder().decode(data);
			},
			blob: async () => {
				const data = await bytes();
				return new Blob([toExactArrayBuffer(data)], {
					type: obj.httpMetadata?.contentType,
				});
			},
			writeHttpMetadata: (headers: Headers) =>
				writeMetadata(httpMetadata, headers),
		} as unknown as R2ObjectBody;
	}

	async delete(keys: string | string[]): Promise<void> {
		const keysArr = Array.isArray(keys) ? keys : [keys];
		await Promise.all(keysArr.map((k) => this.store.delete(k)));
	}

	async list(options?: R2ListOptions): Promise<R2Objects> {
		const res = await this.store.list(options?.prefix ?? "", {
			limit: options?.limit,
			cursor: options?.cursor,
		});

		const objects = res.objects.map((o) => ({
			key: o.key,
			size: o.size,
			uploaded: o.uploaded,
			etag: "",
			httpEtag: "",
			checksums: emptyChecksums,
			version: "",
			storageClass: "Standard",
			writeHttpMetadata: () => {},
		})) as unknown as R2Object[];

		return res.truncated
			? ({
					objects,
					truncated: true,
					cursor: res.cursor ?? "",
					delimitedPrefixes: [],
				} as R2Objects)
			: ({ objects, truncated: false, delimitedPrefixes: [] } as R2Objects);
	}

	async head(key: string): Promise<R2Object | null> {
		const obj = await this.store.get(key);
		if (!obj) return null;
		// BlobStore has no metadata-only HEAD, so this issues a GET under the
		// hood. Release the response body immediately so S3 can reuse the socket.
		await obj.body.cancel().catch(() => {});
		return {
			key,
			version: "",
			size: obj.size ?? 0,
			etag: "",
			httpEtag: "",
			checksums: emptyChecksums,
			uploaded: new Date(),
			httpMetadata: obj.httpMetadata,
			customMetadata: obj.customMetadata,
			storageClass: "Standard",
			writeHttpMetadata: (headers: Headers) =>
				writeMetadata(obj.httpMetadata, headers),
		} as unknown as R2Object;
	}

	async createMultipartUpload(
		_key: string,
		_options?: R2MultipartOptions,
	): Promise<R2MultipartUpload> {
		throw new Error("Multipart upload not implemented for S3 wrapper");
	}

	resumeMultipartUpload(_key: string, _uploadId: string): R2MultipartUpload {
		throw new Error("Multipart upload not implemented for S3 wrapper");
	}
}

const streamToBytes = async (
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> => {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		if (value) chunks.push(value);
	}
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
};
