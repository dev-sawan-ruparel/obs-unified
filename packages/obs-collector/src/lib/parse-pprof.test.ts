import type { PprofProfile } from "@obsunified/pprof-decoder";
import { describe, expect, it } from "vitest";
import { summarizeProfileFrames } from "./parse-pprof";

const tinyProfile = (): PprofProfile => {
	const stringTable = [
		"",
		"cpu",
		"nanoseconds",
		"main.handle",
		"src/main.ts",
		"trace_id",
		"abc123def4567890",
	];
	const functions = new Map();
	functions.set(1, { id: 1, nameIdx: 3, filenameIdx: 4 });
	const locations = new Map();
	locations.set(1, {
		id: 1,
		lines: [{ functionId: 1, line: 42 }],
		functionIds: [1],
	});
	return {
		sampleTypes: [{ typeIdx: 1, unitIdx: 2 }],
		samples: [
			{
				locationIds: [1],
				values: [500],
				labels: [{ keyIdx: 5, strIdx: 6, num: 0 }],
			},
		],
		locations,
		functions,
		stringTable,
	};
};

describe("summarizeProfileFrames", () => {
	it("returns source-linked frame summaries scoped by trace id", () => {
		const frames = summarizeProfileFrames(tinyProfile(), {
			traceIdFilter: "abc123def4567890",
		});

		expect(frames).toEqual([
			{
				name: "main.handle",
				value: 500,
				sampleCount: 1,
				codeReference: {
					originalPath: "src/main.ts",
					relativePath: "src/main.ts",
					absolutePath: undefined,
					lineNumber: 42,
					symbol: "main.handle",
				},
			},
		]);
		expect(
			summarizeProfileFrames(tinyProfile(), {
				traceIdFilter: "ffffffffffffffff",
			}),
		).toEqual([]);
	});
});
