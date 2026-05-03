/**
 * Minimal example: init obs-unified at process startup, then use
 * `withLLMSpan` and `withToolSpan` to instrument an agent loop.
 *
 * Run it (after building):
 *   node --import ./dist/init-shim.js dist/examples/basic.js
 *
 * Auto-instrumentation for HTTP / DB clients comes from the OTel
 * ecosystem — install `@opentelemetry/auto-instrumentations-node` and
 * pass `getNodeAutoInstrumentations()` via `instrumentations` in init.
 */

import { init, setProjectId, withLLMSpan, withToolSpan } from "../src";

const shutdown = init({
	collectorUrl: process.env.OBS_COLLECTOR_URL ?? "http://localhost:8790",
	ingestKey: process.env.OBS_INGEST_KEY ?? "",
	serviceName: "example-agent",
	serviceVersion: "0.1.0",
	environment: "dev",
});

const main = async () => {
	setProjectId("default");

	const answer = await withLLMSpan(
		{ provider: "openai", model: "gpt-4o-mini", maxTokens: 256, turnIndex: 0 },
		async (span) => {
			// Pretend HTTP call — auto-instrumented via OTel's HTTP instrumentation
			// in real apps. The response usage is what we care about here.
			const fakeResponse = {
				choices: [{ message: { content: "It is sunny." } }],
				usage: { prompt_tokens: 42, completion_tokens: 5, total_tokens: 47 },
			};
			span.setUsage({
				inputTokens: fakeResponse.usage.prompt_tokens,
				outputTokens: fakeResponse.usage.completion_tokens,
				totalTokens: fakeResponse.usage.total_tokens,
			});
			span.setFinishReason("stop");
			return fakeResponse.choices[0]?.message.content ?? "";
		},
	);

	const items = await withToolSpan(
		{ name: "list_widgets", args: { color: "blue" } },
		async (span) => {
			const out = ["a", "b", "c"];
			span.setOutcome("ok");
			span.setResultCount(out.length);
			return out;
		},
	);

	console.log({ answer, items });
};

main()
	.catch((err) => {
		console.error(err);
		process.exitCode = 1;
	})
	.finally(async () => {
		await shutdown();
	});
