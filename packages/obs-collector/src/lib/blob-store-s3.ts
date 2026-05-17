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

interface S3ClientShape {
	send(command: unknown): Promise<unknown>;
}

interface S3SdkConstructors {
	// Loose typing so the consumer can pass the AWS SDK's CommandInput types
	// without the BlobStore adapter dragging in a hard dep on
	// @aws-sdk/client-s3. The runtime contract is just "construct with an
	// object literal of S3 params."
	// biome-ignore lint/suspicious/noExplicitAny: <see comment above>
	PutObjectCommand: new (input: any) => unknown;
	// biome-ignore lint/suspicious/noExplicitAny: <see comment above>
	GetObjectCommand: new (input: any) => unknown;
	// biome-ignore lint/suspicious/noExplicitAny: <see comment above>
	DeleteObjectCommand: new (input: any) => unknown;
	// biome-ignore lint/suspicious/noExplicitAny: <see comment above>
	ListObjectsV2Command: new (input: any) => unknown;
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
		const cmd = new this.opts.commands.PutObjectCommand({
			Bucket: this.opts.bucket,
			Key: key,
			Body: body,
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
				Body: ReadableStream<Uint8Array>;
				ContentType?: string;
				ContentEncoding?: string;
				Metadata?: Record<string, string>;
			};
			return {
				body: r.Body,
				bytes: async () => {
					const reader = r.Body.getReader();
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
				},
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

	async list(prefix: string, options?: BlobListOptions): Promise<BlobListResult> {
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
