/**
 * Text <-> value helpers for the alert rule form and the rule detail view:
 * metric name lists ("a, b"), attribute filters ("code=500, route=/x"),
 * email recipient lists, and one-line summaries of a metrics query and a
 * channel.
 */

import type {
	AlertChannel,
	AlertMetricAggregation,
	AlertMetricAttributeValue,
	AlertMetricField,
	AlertMetricSelector,
	AlertQueryMetrics,
} from "@obsunified/types";

export const METRIC_AGGREGATIONS: Array<{
	value: AlertMetricAggregation;
	label: string;
}> = [
	{ value: "last", label: "last" },
	{ value: "min", label: "min" },
	{ value: "max", label: "max" },
	{ value: "avg", label: "avg" },
	{ value: "sum", label: "sum" },
	{ value: "increase", label: "increase (counter)" },
	{ value: "rate", label: "rate per second" },
	{ value: "age_seconds", label: "age_seconds (staleness)" },
];

export const METRIC_FIELDS: AlertMetricField[] = ["value", "count", "sum"];

const splitList = (text: string): string[] =>
	text
		.split(/[,\n]/)
		.map((s) => s.trim())
		.filter(Boolean);

/** "a, b" → "a" or ["a", "b"]; empty → "". */
export const parseMetricNames = (text: string): string | string[] => {
	const names = splitList(text);
	if (names.length === 0) return "";
	return names.length === 1 ? names[0] : names;
};

export const formatMetricNames = (metric: string | string[] | undefined) =>
	Array.isArray(metric) ? metric.join(", ") : (metric ?? "");

/**
 * "code=500, route=/x" → { code: "500", route: "/x" }. Values stay strings
 * (the evaluator compares attribute values as strings). Returns an error
 * message for an entry without "=".
 */
export const parseAttributes = (
	text: string,
):
	| { ok: true; value: Record<string, string> | undefined }
	| { ok: false; error: string } => {
	const entries = splitList(text);
	if (entries.length === 0) return { ok: true, value: undefined };
	const out: Record<string, string> = {};
	for (const entry of entries) {
		const eq = entry.indexOf("=");
		if (eq <= 0)
			return { ok: false, error: `"${entry}" is not attribute=value` };
		out[entry.slice(0, eq).trim()] = entry.slice(eq + 1).trim();
	}
	return { ok: true, value: out };
};

export const formatAttributes = (
	attrs: Record<string, AlertMetricAttributeValue> | undefined,
): string =>
	attrs
		? Object.entries(attrs)
				.map(([k, v]) => `${k}=${String(v)}`)
				.join(", ")
		: "";

export const parseRecipients = (text: string): string[] => splitList(text);

const selectorText = (s: AlertMetricSelector): string => {
	const names = Array.isArray(s.metric) ? s.metric.join(" + ") : s.metric;
	const filters = [
		s.serviceName ? `service.name=${s.serviceName}` : "",
		formatAttributes(s.attributes),
		formatAttributes(s.resourceAttributes),
	]
		.filter(Boolean)
		.join(", ");
	const field = s.field && s.field !== "value" ? `.${s.field}` : "";
	return `${names}${field}${filters ? `{${filters}}` : ""}`;
};

/** e.g. `increase(errors_total{code=500}) / increase(calls_total) (min 5)` */
export const describeMetricQuery = (q: AlertQueryMetrics): string => {
	const num = `${q.aggregation}(${selectorText(q)})`;
	if (!q.denominator) return num;
	const den = `${q.denominator.aggregation ?? q.aggregation}(${selectorText(q.denominator)})`;
	const min = q.minDenominator
		? ` (when denominator >= ${q.minDenominator})`
		: "";
	return `${num} / ${den}${min}`;
};

/** Webhook URLs often carry a secret path, so only the host is shown. */
export const describeChannel = (ch: AlertChannel): string => {
	if (ch.type === "email") return `email → ${ch.to.join(", ")}`;
	try {
		return `webhook → ${new URL(ch.url).host}`;
	} catch {
		return "webhook";
	}
};
