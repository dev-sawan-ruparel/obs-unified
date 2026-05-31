/**
 * Thin provider wrappers that call OpenAI / Anthropic / Gemini via plain
 * fetch. No SDK dependencies — keeps the bundle small and avoids Workers
 * runtime quirks. Each function opens an OpenInference LLM span, calls the
 * provider, and attaches tokens / output to the span.
 */

import { startLLMSpan } from "@obs-unified/telemetry-sdk";

export type ProviderName = "openai" | "anthropic" | "gemini";

export interface Message {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LLMResult {
	text: string;
	spanId: string;
	provider: ProviderName;
	model: string;
}

export interface Env {
	OPENAI_API_KEY?: string;
	ANTHROPIC_API_KEY?: string;
	GOOGLE_API_KEY?: string;
	OPENAI_MODEL?: string;
	ANTHROPIC_MODEL?: string;
	GEMINI_MODEL?: string;
}

export function availableProviders(env: Env): ProviderName[] {
	const out: ProviderName[] = [];
	if (env.OPENAI_API_KEY) out.push("openai");
	if (env.ANTHROPIC_API_KEY) out.push("anthropic");
	if (env.GOOGLE_API_KEY) out.push("gemini");
	return out;
}

// ── OpenAI ─────────────────────────────────────────────────────────────────

export async function askOpenAI(
	env: Env,
	messages: Message[],
): Promise<LLMResult> {
	const model = env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
	const span = startLLMSpan({
		model,
		provider: "openai",
		input: messages,
		name: "openai.chat.completions",
	});
	try {
		const res = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.OPENAI_API_KEY}`,
			},
			body: JSON.stringify({
				model,
				messages: messages.map((m) => ({ role: m.role, content: m.content })),
				max_tokens: 200,
			}),
		});
		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
		}
		const body = (await res.json()) as {
			choices: Array<{ message: { content: string | null } }>;
			usage?: {
				prompt_tokens?: number;
				completion_tokens?: number;
				total_tokens?: number;
			};
		};
		const text = body.choices[0]?.message?.content ?? "";
		span.setOutput(body.choices[0]?.message ?? { text });
		span.setTokens({
			prompt: body.usage?.prompt_tokens,
			completion: body.usage?.completion_tokens,
			total: body.usage?.total_tokens,
		});
		span.end();
		return { text, spanId: span.spanId, provider: "openai", model };
	} catch (err) {
		span.setError(err instanceof Error ? err.message : String(err));
		throw err;
	}
}

// ── Anthropic ──────────────────────────────────────────────────────────────

export async function askAnthropic(
	env: Env,
	messages: Message[],
): Promise<LLMResult> {
	const model = env.ANTHROPIC_MODEL?.trim() || "claude-3-5-haiku-latest";
	const span = startLLMSpan({
		model,
		provider: "anthropic",
		input: messages,
		name: "anthropic.messages.create",
	});
	try {
		const system = messages.find((m) => m.role === "system")?.content;
		const convo = messages
			.filter((m) => m.role !== "system")
			.map((m) => ({ role: m.role, content: m.content }));
		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": env.ANTHROPIC_API_KEY ?? "",
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model,
				max_tokens: 200,
				system,
				messages: convo,
			}),
		});
		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 200)}`);
		}
		const body = (await res.json()) as {
			content: Array<{ type: string; text?: string }>;
			usage?: { input_tokens?: number; output_tokens?: number };
			stop_reason?: string;
		};
		const text = body.content
			.filter((b) => b.type === "text")
			.map((b) => b.text ?? "")
			.join("");
		span.setOutput(body);
		const inputTokens = body.usage?.input_tokens ?? 0;
		const outputTokens = body.usage?.output_tokens ?? 0;
		span.setTokens({
			prompt: inputTokens,
			completion: outputTokens,
			total: inputTokens + outputTokens,
		});
		span.end();
		return { text, spanId: span.spanId, provider: "anthropic", model };
	} catch (err) {
		span.setError(err instanceof Error ? err.message : String(err));
		throw err;
	}
}

// ── Gemini ─────────────────────────────────────────────────────────────────

export async function askGemini(
	env: Env,
	messages: Message[],
): Promise<LLMResult> {
	const model = env.GEMINI_MODEL?.trim() || "gemini-1.5-flash";
	const span = startLLMSpan({
		model,
		provider: "google",
		input: messages,
		name: "gemini.generateContent",
	});
	try {
		const systemInstruction = messages.find(
			(m) => m.role === "system",
		)?.content;
		const contents = messages
			.filter((m) => m.role !== "system")
			.map((m) => ({
				role: m.role === "assistant" ? "model" : m.role,
				parts: [{ text: m.content }],
			}));

		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GOOGLE_API_KEY}`;
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				systemInstruction: systemInstruction
					? { role: "system", parts: [{ text: systemInstruction }] }
					: undefined,
				contents,
				generationConfig: { maxOutputTokens: 200 },
			}),
		});
		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
		}
		const body = (await res.json()) as {
			candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
			usageMetadata?: {
				promptTokenCount?: number;
				candidatesTokenCount?: number;
				totalTokenCount?: number;
			};
		};
		const text = (body.candidates?.[0]?.content?.parts ?? [])
			.map((p) => p.text ?? "")
			.join("");
		span.setOutput(body);
		span.setTokens({
			prompt: body.usageMetadata?.promptTokenCount,
			completion: body.usageMetadata?.candidatesTokenCount,
			total: body.usageMetadata?.totalTokenCount,
		});
		span.end();
		return { text, spanId: span.spanId, provider: "gemini", model };
	} catch (err) {
		span.setError(err instanceof Error ? err.message : String(err));
		throw err;
	}
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

export async function ask(
	env: Env,
	provider: ProviderName,
	messages: Message[],
): Promise<LLMResult> {
	if (provider === "openai") return askOpenAI(env, messages);
	if (provider === "anthropic") return askAnthropic(env, messages);
	return askGemini(env, messages);
}
