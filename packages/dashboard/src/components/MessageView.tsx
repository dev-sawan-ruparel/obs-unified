/**
 * Render LLM input/output payloads as chat-style messages when they match
 * a recognizable shape. Falls back to JsonBlock for anything else.
 *
 * Recognized shapes:
 *  - OpenAI chat: [{role: "user"|"assistant"|"system", content: string}]
 *  - Anthropic:   content blocks [{type: "text", text: string}]
 *  - Gemini:      [{role: "user"|"model", parts: [{text: string}]}]
 *  - Scalar:      plain string → single assistant bubble
 */

import type { ReactNode } from "react";
import { ChatBubble, JsonBlock } from "./primitives";

type Role = "user" | "assistant" | "system" | "tool";

interface NormalizedMessage {
	role: Role;
	content: string;
	/** Additional metadata (tool name, name, etc.) for labelling */
	meta?: string;
}

export function MessageView({
	raw,
	label,
	defaultRole = "assistant",
	accent,
}: {
	raw: string | null | undefined;
	label?: string;
	defaultRole?: Role;
	accent?: "error" | "primary" | "accent";
}) {
	if (!raw) {
		return <JsonBlock value={null} label={label} />;
	}
	const parsed = safeParse(raw);
	const messages = normalize(parsed, defaultRole);

	if (!messages) {
		// Not a known message shape — show as pretty JSON.
		return <JsonBlock value={raw} label={label} accent={accent} />;
	}

	return (
		<div className="flex flex-col gap-2">
			{label && (
				<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">
					{label}
				</div>
			)}
			<div className="flex flex-col gap-2">
				{messages.map((m, i) => (
					<ChatBubble
						key={i}
						role={m.role}
						subtitle={m.meta}
						accent={accent === "error" && m.role === "assistant" ? "error" : undefined}
					>
						{renderContent(m.content)}
					</ChatBubble>
				))}
			</div>
		</div>
	);
}

function renderContent(content: string): ReactNode {
	// Wrap long unbroken strings so they don't blow out the bubble width.
	return <span className="whitespace-pre-wrap break-words">{content}</span>;
}

function safeParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function normalize(
	value: unknown,
	defaultRole: Role,
): NormalizedMessage[] | null {
	// Plain string
	if (typeof value === "string") {
		return [{ role: defaultRole, content: value }];
	}

	// OpenAI response message (single): { role, content }
	if (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		"role" in value &&
		"content" in value
	) {
		const obj = value as { role?: unknown; content?: unknown; name?: unknown };
		const role = normalizeRole(obj.role, defaultRole);
		const content = coerceContent(obj.content);
		if (content === null) return null;
		return [
			{
				role,
				content,
				meta: typeof obj.name === "string" ? obj.name : undefined,
			},
		];
	}

	// Anthropic full response: { content: [{type:"text", text}], stop_reason }
	if (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		"content" in value &&
		Array.isArray((value as { content?: unknown[] }).content)
	) {
		const blocks = (value as { content: unknown[] }).content;
		const text = blocks
			.map((b) => {
				if (typeof b === "string") return b;
				if (b && typeof b === "object" && "text" in b) {
					return String((b as { text?: unknown }).text ?? "");
				}
				if (b && typeof b === "object" && "type" in b) {
					return `[${(b as { type?: unknown }).type ?? "block"}]`;
				}
				return "";
			})
			.filter(Boolean)
			.join("\n");
		if (!text) return null;
		return [{ role: "assistant", content: text }];
	}

	// Array of messages
	if (Array.isArray(value)) {
		const out: NormalizedMessage[] = [];
		for (const item of value) {
			const single = normalize(item, defaultRole);
			if (!single) return null;
			out.push(...single);
		}
		return out.length > 0 ? out : null;
	}

	return null;
}

function normalizeRole(role: unknown, fallback: Role): Role {
	if (typeof role !== "string") return fallback;
	const r = role.toLowerCase();
	if (r === "user" || r === "human") return "user";
	if (r === "assistant" || r === "model" || r === "ai") return "assistant";
	if (r === "system") return "system";
	if (r === "tool" || r === "function") return "tool";
	return fallback;
}

function coerceContent(content: unknown): string | null {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		// OpenAI vision / Gemini parts
		const pieces = content
			.map((c) => {
				if (typeof c === "string") return c;
				if (c && typeof c === "object" && "text" in c) {
					return String((c as { text?: unknown }).text ?? "");
				}
				if (c && typeof c === "object" && "type" in c) {
					return `[${(c as { type?: unknown }).type ?? "part"}]`;
				}
				return "";
			})
			.filter(Boolean);
		return pieces.length > 0 ? pieces.join("\n") : null;
	}
	// Gemini parts: { parts: [{text}] }
	if (content && typeof content === "object" && "parts" in content) {
		return coerceContent((content as { parts?: unknown }).parts);
	}
	return null;
}
