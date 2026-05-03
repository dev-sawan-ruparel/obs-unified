/**
 * Cloudflare R2 instrumentation — wraps a `R2Bucket` binding so storage
 * operations become child spans on the active request span. Drop-in: the
 * returned object is shape-compatible with `R2Bucket`.
 *
 * Spans set:
 *   r2.operation  — get / put / head / delete / list
 *   r2.bucket     — the bucket binding name (when supplied via opts.bucketName)
 *   r2.key        — the object key (truncated to maxKeyChars)
 *   r2.size_bytes — for `put`: input size; for `get`: response size
 */

import { withChildSpan } from "./span";

export interface WrapR2Options {
	/** Bucket binding name to stamp onto every span. */
	bucketName?: string;
	/** Span-name prefix; defaults to `"r2"`. */
	spanNamePrefix?: string;
	/** Max chars of the object key captured into `r2.key`. Defaults to 256. */
	maxKeyChars?: number;
}

const truncate = (s: string, max: number): string =>
	s.length > max ? `${s.slice(0, max)}…` : s;

const sizeOf = (value: unknown): number | undefined => {
	if (value == null) return undefined;
	if (typeof value === "string") return value.length;
	if (value instanceof ArrayBuffer) return value.byteLength;
	if (ArrayBuffer.isView(value)) return value.byteLength;
	if (value instanceof Blob) return value.size;
	return undefined;
};

export const wrapR2 = <T extends R2Bucket>(
	bucket: T,
	opts?: WrapR2Options,
): T => {
	const prefix = opts?.spanNamePrefix ?? "r2";
	const maxKeyChars = opts?.maxKeyChars ?? 256;
	const bucketName = opts?.bucketName;

	const trace = async <R>(
		operation: string,
		key: string | undefined,
		extra: Record<string, unknown>,
		exec: (span: {
			setAttribute(k: string, v: unknown): void;
		}) => Promise<R>,
	): Promise<R> =>
		withChildSpan(`${prefix}.${operation}`, async (span) => {
			span.setAttribute("r2.operation", operation);
			if (bucketName) span.setAttribute("r2.bucket", bucketName);
			if (key) span.setAttribute("r2.key", truncate(key, maxKeyChars));
			for (const [k, v] of Object.entries(extra))
				if (v !== undefined) span.setAttribute(k, v);
			try {
				return await exec(span);
			} catch (err) {
				span.setStatus(2, err instanceof Error ? err.message : String(err));
				throw err;
			}
		});

	return new Proxy(bucket, {
		get(target, prop, receiver) {
			if (prop === "get") {
				return async (key: string, options?: unknown) =>
					trace("get", key, {}, async (span) => {
						const result = await (target.get as (
							k: string,
							o?: unknown,
						) => Promise<R2ObjectBody | null>)(key, options);
						if (result && typeof result.size === "number")
							span.setAttribute("r2.size_bytes", result.size);
						return result;
					});
			}
			if (prop === "put") {
				return async (
					key: string,
					value: unknown,
					options?: unknown,
				) =>
					trace(
						"put",
						key,
						{ "r2.size_bytes": sizeOf(value) },
						async () =>
							(
								target.put as (
									k: string,
									v: unknown,
									o?: unknown,
								) => Promise<R2Object>
							)(key, value, options),
					);
			}
			if (prop === "head") {
				return async (key: string) =>
					trace("head", key, {}, async () => target.head(key));
			}
			if (prop === "delete") {
				return async (key: string | string[]) =>
					trace(
						"delete",
						Array.isArray(key) ? `[${key.length} keys]` : key,
						{ "r2.batch_size": Array.isArray(key) ? key.length : 1 },
						async () =>
							(
								target.delete as (k: string | string[]) => Promise<void>
							)(key),
					);
			}
			if (prop === "list") {
				return async (options?: unknown) =>
					trace("list", undefined, {}, async (span) => {
						const result = await (target.list as (
							o?: unknown,
						) => Promise<R2Objects>)(options);
						if (result && Array.isArray(result.objects))
							span.setAttribute("r2.result_count", result.objects.length);
						return result;
					});
			}
			return Reflect.get(target, prop, receiver);
		},
	}) as T;
};
