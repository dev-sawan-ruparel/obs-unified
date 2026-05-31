/**
 * S3-compatible adapter for `BlobStore`. Works against AWS S3, MinIO,
 * Cloudflare R2's S3 API, Backblaze B2, etc.
 *
 * Uses `@aws-sdk/client-s3` v3. The adapter is intentionally thin —
 * just enough to satisfy `BlobStore` for replay + pprof payloads. We
 * deliberately do NOT expose pre-signed URLs, ACLs, or storage-class
 * tuning — those belong in a richer storage adapter for users that
 * outgrow the default.
 */

import type {
	BlobListOptions,
	BlobListResult,
	BlobObject,
	BlobPutOptions,
	BlobStore,
} from "./blob-store";

type S3Body = Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>;
type S3CommandBody = Exclude<S3Body, ArrayBuffer>;
type S3ResponseBody =
	| ReadableStream<Uint8Array>
	| AsyncIterable<Uint8Array | ArrayBuffer | ArrayBufferView | string>
	| {
			transformToWebStream(): ReadableStream<Uint8Array>;
	  };

interface S3ClientShape {
	send(command: unknown): Promise<unknown>;
}

interface S3SdkConstructors {
	// Loose typing so the consumer can pass the AWS SDK's CommandInput types
	// without the BlobStore adapter dragging in a hard dep on
	// @aws-sdk/client-s3. The runtime contract is just "construct with an
	// object literal of S3 params."
	PutObjectCommand: new (input: {
		Bucket: string;
		Key: string;
		Body?: S3CommandBody;
		ContentType?: string;
		ContentEncoding?: string;
		Metadata?: Record<string, string>;
	}) => unknown;
	GetObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
	DeleteObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
	ListObjectsV2Command: new (input: {
		Bucket: string;
		Prefix: string;
		MaxKeys?: number;
		ContinuationToken?: string;
	}) => unknown;
}

export interface S3BlobStoreOptions {
	client: S3ClientShape;
	commands: S3SdkConstructors;
	bucket: string;
}

export class S3BlobStore implements BlobStore {
	constructor(private readonly opts: S3BlobStoreOptions) {}

	async put(
		key: string,
		body: S3Body,
		options?: BlobPutOptions,
	): Promise<void> {
		const commandBody: S3CommandBody =
			body instanceof ArrayBuffer ? new Uint8Array(body) : body;
		const cmd = new this.opts.commands.PutObjectCommand({
			Bucket: this.opts.bucket,
			Key: key,
			Body: commandBody,
			ContentType: options?.httpMetadata?.contentType,
			ContentEncoding: options?.httpMetadata?.contentEncoding,
			Metadata: options?.customMetadata,
		});
		await this.opts.client.send(cmd);
	}

	async get(key: string): Promise<BlobObject | null> {
		const cmd = new this.opts.commands.GetObjectCommand({
			Bucket: this.opts.bucket,
			Key: key,
		});
		try {
			const r = (await this.opts.client.send(cmd)) as {
				Body: S3ResponseBody;
				ContentLength?: number;
				ContentType?: string;
				ContentEncoding?: string;
				Metadata?: Record<string, string>;
			};
			const body = toWebReadableStream(r.Body);
			return {
				body,
				size: r.ContentLength,
				bytes: () => streamToBytes(body),
				httpMetadata: {
					contentType: r.ContentType,
					contentEncoding: r.ContentEncoding,
				},
				customMetadata: r.Metadata,
			};
		} catch (err: unknown) {
			if (isNotFound(err)) return null;
			throw err;
		}
	}

	async delete(key: string): Promise<void> {
		const cmd = new this.opts.commands.DeleteObjectCommand({
			Bucket: this.opts.bucket,
			Key: key,
		});
		await this.opts.client.send(cmd);
	}

	async list(
		prefix: string,
		options?: BlobListOptions,
	): Promise<BlobListResult> {
		const cmd = new this.opts.commands.ListObjectsV2Command({
			Bucket: this.opts.bucket,
			Prefix: prefix,
			MaxKeys: options?.limit,
			ContinuationToken: options?.cursor,
		});
		const r = (await this.opts.client.send(cmd)) as {
			Contents?: Array<{ Key?: string; Size?: number; LastModified?: Date }>;
			NextContinuationToken?: string;
			IsTruncated?: boolean;
		};
		return {
			objects: (r.Contents ?? [])
				.filter((o): o is { Key: string; Size: number; LastModified: Date } =>
					Boolean(o.Key && o.Size !== undefined && o.LastModified),
				)
				.map((o) => ({
					key: o.Key,
					size: o.Size,
					uploaded: o.LastModified,
				})),
			cursor: r.NextContinuationToken,
			truncated: Boolean(r.IsTruncated),
		};
	}
}

const isNotFound = (err: unknown): boolean => {
	if (!err || typeof err !== "object") return false;
	const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
	return e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
};

const toWebReadableStream = (
	body: S3ResponseBody,
): ReadableStream<Uint8Array> => {
	if (body instanceof ReadableStream) return body;
	if ("transformToWebStream" in body) return body.transformToWebStream();
	if (Symbol.asyncIterator in body) return asyncIterableToStream(body);
	throw new Error("Unsupported S3 response body type");
};

const asyncIterableToStream = (
	iterable: AsyncIterable<Uint8Array | ArrayBuffer | ArrayBufferView | string>,
): ReadableStream<Uint8Array> => {
	const iterator = iterable[Symbol.asyncIterator]();
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { value, done } = await iterator.next();
			if (done) {
				controller.close();
				return;
			}
			controller.enqueue(toUint8Array(value));
		},
		async cancel(reason) {
			await iterator.return?.(reason);
		},
	});
};

const toUint8Array = (
	value: Uint8Array | ArrayBuffer | ArrayBufferView | string,
): Uint8Array => {
	if (typeof value === "string") return new TextEncoder().encode(value);
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
};

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
	const total = chunks.reduce((n, c) => n + c.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.byteLength;
	}
	return out;
};
