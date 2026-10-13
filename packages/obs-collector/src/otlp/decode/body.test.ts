import { gzipSync } from "node:zlib";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { OtlpDecodeError, type ReadBodyLimits, readOtlpBody } from "./body";

const MIB = 1024 * 1024;

const read = async (
	body: BodyInit,
	headers: Record<string, string>,
	limits: ReadBodyLimits = {},
) => {
	const app = new Hono().post("/t", async (c) => {
		try {
			const result = await readOtlpBody(c, limits);
			return c.json({
				bytes: result.bytes.byteLength,
				wire: result.wireFormat,
			});
		} catch (err) {
			if (err instanceof OtlpDecodeError)
				return c.json({ error: err.message }, err.status);
			throw err;
		}
	});
	const res = await app.request("/t", { method: "POST", body, headers });
	return {
		status: res.status,
		body: (await res.json()) as Record<string, unknown>,
	};
};

describe("readOtlpBody limits", () => {
	it("decompresses a normal gzip payload", async () => {
		const json = JSON.stringify({ resourceSpans: [] });
		const res = await read(gzipSync(json), {
			"content-type": "application/json",
			"content-encoding": "gzip",
		});
		expect(res).toEqual({
			status: 200,
			body: { bytes: json.length, wire: "json" },
		});
	});

	it("refuses a gzip bomb once the decompressed cap is crossed", async () => {
		// 8 MiB of zeros gzips to a few KiB; the reader must stop at 1 MiB.
		const bomb = gzipSync(Buffer.alloc(8 * MIB));
		expect(bomb.byteLength).toBeLessThan(64 * 1024);
		const res = await read(
			bomb,
			{ "content-type": "application/x-protobuf", "content-encoding": "gzip" },
			{ maxDecompressedBytes: MIB },
		);
		expect(res.status).toBe(413);
		expect(res.body.error).toMatch(/Decompressed payload too large/);
	});

	it("refuses a raw body over the configured cap", async () => {
		const res = await read(
			"x".repeat(2048),
			{ "content-type": "application/json" },
			{ maxBodyBytes: 1024 },
		);
		expect(res.status).toBe(413);
		expect(res.body.error).toMatch(/Payload too large \(max 1024 bytes\)/);
	});

	it("reports malformed gzip as 400, not 500", async () => {
		const res = await read("definitely not gzip", {
			"content-type": "application/json",
			"content-encoding": "gzip",
		});
		expect(res.status).toBe(400);
	});
});
