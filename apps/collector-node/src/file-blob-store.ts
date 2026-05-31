import type { Dirent } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
	BlobListOptions,
	BlobListResult,
	BlobObject,
	BlobPutOptions,
	BlobStore,
} from "@obs-unified/collector";

export interface FileBlobStoreOptions {
	root: string;
}

export class FileBlobStore implements BlobStore {
	constructor(private readonly opts: FileBlobStoreOptions) {}

	async put(
		key: string,
		body: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
		_options?: BlobPutOptions,
	): Promise<void> {
		const file = this.pathFor(key);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, await bodyToBytes(body));
	}

	async get(key: string): Promise<BlobObject | null> {
		const file = this.pathFor(key);
		try {
			const info = await stat(file);
			return {
				body: new Blob([await readFile(file)]).stream(),
				bytes: async () => new Uint8Array(await readFile(file)),
				size: info.size,
			};
		} catch (err) {
			if (isNotFound(err)) return null;
			throw err;
		}
	}

	async delete(key: string): Promise<void> {
		await rm(this.pathFor(key), { force: true });
	}

	async list(
		prefix: string,
		options?: BlobListOptions,
	): Promise<BlobListResult> {
		const entries = await this.walk(this.opts.root);
		const objects = entries
			.map((entry) => ({
				key: path
					.relative(this.opts.root, entry.file)
					.split(path.sep)
					.join("/"),
				size: entry.size,
				uploaded: entry.mtime,
			}))
			.filter((entry) => entry.key.startsWith(prefix))
			.sort((a, b) => a.key.localeCompare(b.key));

		const start = options?.cursor
			? Number.parseInt(options.cursor, 10) || 0
			: 0;
		const limit = options?.limit ?? 1000;
		const slice = objects.slice(start, start + limit);
		const next =
			start + limit < objects.length ? String(start + limit) : undefined;
		return {
			objects: slice,
			cursor: next,
			truncated: Boolean(next),
		};
	}

	private pathFor(key: string) {
		const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
		const out = path.resolve(this.opts.root, normalized);
		const root = path.resolve(this.opts.root);
		if (out !== root && !out.startsWith(`${root}${path.sep}`)) {
			throw new Error(`blob key escapes root: ${key}`);
		}
		return out;
	}

	private async walk(
		dir: string,
	): Promise<Array<{ file: string; size: number; mtime: Date }>> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (err) {
			if (isNotFound(err)) return [];
			throw err;
		}

		const out: Array<{ file: string; size: number; mtime: Date }> = [];
		for (const entry of entries) {
			const file = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				out.push(...(await this.walk(file)));
			} else if (entry.isFile()) {
				const info = await stat(file);
				out.push({ file, size: info.size, mtime: info.mtime });
			}
		}
		return out;
	}
}

function isNotFound(err: unknown) {
	return (
		typeof err === "object" &&
		err !== null &&
		"code" in err &&
		err.code === "ENOENT"
	);
}

async function bodyToBytes(
	body: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	if (body instanceof Uint8Array) return body;
	if (body instanceof ArrayBuffer) return new Uint8Array(body);

	const chunks: Uint8Array[] = [];
	const reader = body.getReader();
	while (true) {
		const { done, value } = await reader.read();
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
}
