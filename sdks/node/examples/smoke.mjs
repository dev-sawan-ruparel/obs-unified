// Runtime smoke test: emits an LLM span, a tool span, sets a project id,
// and waits for the OTel batch processor to flush before exit.
//
// Run with the collector at OBS_COLLECTOR_URL and an obs-dashboard ingest
// key in OBS_INGEST_KEY. After the script exits, inspect D1 for spans
// matching service.name = "smoke-node-sdk".

import {
	init,
	setProjectId,
	withLLMSpan,
	withToolSpan,
} from "../dist/index.js";

const shutdown = init({
	collectorUrl: process.env.OBS_COLLECTOR_URL ?? "http://localhost:8790",
	ingestKey: process.env.OBS_INGEST_KEY ?? "",
	serviceName: "smoke-node-sdk",
	serviceVersion: "0.1.0",
	environment: "dev",
	projectId: "obs-dashboard",
});

const main = async () => {
	const answer = await withLLMSpan(
		{
			provider: "openai",
			model: "gpt-4o-mini",
			maxTokens: 256,
			turnIndex: 0,
		},
		async (span) => {
			// Pretend HTTP call. In real apps the wrapped fetch via
			// @opentelemetry/instrumentation-http creates a child HTTP span.
			const fakeResponse = {
				choices: [
					{ message: { content: "It is sunny." }, finish_reason: "stop" },
				],
				usage: { prompt_tokens: 42, completion_tokens: 5, total_tokens: 47 },
			};
			span.setUsage({
				inputTokens: fakeResponse.usage.prompt_tokens,
				outputTokens: fakeResponse.usage.completion_tokens,
				totalTokens: fakeResponse.usage.total_tokens,
			});
			span.setFinishReason(fakeResponse.choices[0].finish_reason);
			setProjectId("obs-dashboard");
			return fakeResponse.choices[0].message.content;
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

	console.log(JSON.stringify({ answer, items }));
};

await main();
// Force-flush via shutdown so the batch processor exports before we exit.
await shutdown();
