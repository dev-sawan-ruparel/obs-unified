// @vitest-environment jsdom
import type { AlertRule, AlertRuleInput } from "@obsunified/types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AlertRuleForm } from "../dashboards/AlertRuleForm";
import { AlertsDashboard } from "../dashboards/AlertsDashboard";
import {
	describeChannel,
	describeMetricQuery,
	parseAttributes,
	parseMetricNames,
} from "../dashboards/alert-rule-text";
import { ObsDashboardProvider } from "../provider";

afterEach(() => cleanup());

const byLabel = (label: string) => {
	const node = screen.getByText(label).parentElement;
	const input = node?.querySelector("input, select");
	if (!input) throw new Error(`no input for ${label}`);
	return input as HTMLInputElement | HTMLSelectElement;
};

describe("alert rule text helpers", () => {
	it("parses metric names and attribute filters", () => {
		expect(parseMetricNames("a_total")).toBe("a_total");
		expect(parseMetricNames(" a_total, b_total ")).toEqual([
			"a_total",
			"b_total",
		]);
		expect(parseAttributes("code=500, route=/x")).toEqual({
			ok: true,
			value: { code: "500", route: "/x" },
		});
		expect(parseAttributes("oops")).toEqual({
			ok: false,
			error: '"oops" is not attribute=value',
		});
	});

	it("describes a ratio query and hides webhook paths", () => {
		expect(
			describeMetricQuery({
				metric: ["in_failed_total", "out_failed_total"],
				attributes: { code: 500 },
				aggregation: "increase",
				denominator: { metric: "calls_total" },
				minDenominator: 5,
			}),
		).toBe(
			"increase(in_failed_total + out_failed_total{code=500}) / increase(calls_total) (when denominator >= 5)",
		);
		expect(
			describeChannel({
				type: "webhook",
				url: "https://hooks.slack.com/services/T/B/secret",
			}),
		).toBe("webhook → hooks.slack.com");
		expect(describeChannel({ type: "email", to: ["a@x.io"] })).toBe(
			"email → a@x.io",
		);
	});
});

describe("AlertRuleForm metrics signal", () => {
	it("builds a metrics ratio rule with pendingSecs and an email channel", async () => {
		const submitted: AlertRuleInput[] = [];
		render(
			<AlertRuleForm
				onSubmit={async (input) => {
					submitted.push(input);
				}}
				onCancel={() => {}}
				submitting={false}
			/>,
		);
		fireEvent.change(byLabel("Name"), { target: { value: "Call errors" } });
		fireEvent.change(byLabel("Signal"), { target: { value: "metrics" } });
		fireEvent.change(byLabel("Comparison"), { target: { value: ">" } });
		fireEvent.change(byLabel("Threshold"), { target: { value: "0.05" } });
		fireEvent.change(byLabel("For (s)"), { target: { value: "60" } });
		fireEvent.change(byLabel("Metric (comma-separated names are summed)"), {
			target: { value: "in_failed_total, out_failed_total" },
		});
		fireEvent.change(byLabel("Aggregation"), {
			target: { value: "increase" },
		});
		fireEvent.change(byLabel("Stale after (s)"), { target: { value: "120" } });
		fireEvent.change(byLabel("No data"), { target: { value: "keep" } });
		fireEvent.click(screen.getByText("Ratio: divide by a denominator"));
		fireEvent.change(byLabel("Denominator metric"), {
			target: { value: "calls_total" },
		});
		fireEvent.change(byLabel("Minimum denominator"), {
			target: { value: "5" },
		});
		// Replace the default webhook row with an email row.
		fireEvent.click(screen.getByText("Remove"));
		fireEvent.click(screen.getByText("+ Email"));
		fireEvent.change(
			screen.getByPlaceholderText("oncall@example.com, ops@example.com"),
			{ target: { value: "oncall@example.com, ops@example.com" } },
		);
		fireEvent.click(screen.getByText("Create"));
		await screen.findByText("Create");

		expect(submitted).toEqual([
			{
				name: "Call errors",
				signal: "metrics",
				query: {
					metric: ["in_failed_total", "out_failed_total"],
					aggregation: "increase",
					denominator: { metric: "calls_total" },
					minDenominator: 5,
					noData: "keep",
					staleSecs: 120,
				},
				threshold: 0.05,
				windowMins: 5,
				comparison: ">",
				channels: [
					{ type: "email", to: ["oncall@example.com", "ops@example.com"] },
				],
				enabled: true,
				pendingSecs: 60,
			},
		]);
	});

	it("loads an existing metrics rule for editing", () => {
		const rule: AlertRule = {
			id: "r1",
			projectId: "p",
			name: "pg down",
			signal: "metrics",
			query: {
				metric: "pg_up",
				aggregation: "last",
				resourceAttributes: { "deployment.environment": "prod" },
			},
			threshold: 0,
			windowMins: 1,
			comparison: "==",
			channels: [{ type: "webhook", url: "https://hooks.example.com/x" }],
			enabled: true,
			createdAt: "2026-10-31T00:00:00.000Z",
			updatedAt: "2026-10-31T00:00:00.000Z",
			pendingSecs: 30,
		};
		render(
			<AlertRuleForm
				initial={rule}
				onSubmit={async () => {}}
				onCancel={() => {}}
				submitting={false}
			/>,
		);
		expect(byLabel("Metric (comma-separated names are summed)").value).toBe(
			"pg_up",
		);
		expect(byLabel("Resource attributes (key=value, …)").value).toBe(
			"deployment.environment=prod",
		);
		expect(byLabel("Comparison").value).toBe("==");
		expect(byLabel("For (s)").value).toBe("30");
	});
});

describe("AlertsDashboard evaluation status", () => {
	it("shows erroring, no-data and undelivered rules in the list", async () => {
		const base = {
			projectId: "p",
			signal: "metrics" as const,
			query: { metric: "m", aggregation: "last" as const },
			threshold: 0,
			windowMins: 1,
			comparison: ">" as const,
			channels: [],
			enabled: true,
			createdAt: "2026-10-31T00:00:00.000Z",
			updatedAt: "2026-10-31T00:00:00.000Z",
		};
		const rules: AlertRule[] = [
			{
				...base,
				id: "a",
				name: "erroring rule",
				notificationDelivered: null,
				lastEvaluation: {
					evaluatedAt: "2026-10-31T10:05:00.000Z",
					outcome: "error",
					value: 0,
					error: "metrics query matches 1200 series (limit 1000)",
				},
			},
			{
				...base,
				id: "b",
				name: "undelivered rule",
				currentState: "firing",
				notificationDelivered: false,
				lastEvaluation: {
					evaluatedAt: "2026-10-31T10:05:00.000Z",
					outcome: "no_data",
					value: 0,
					error: null,
				},
			},
		];
		const fetcher: typeof fetch = async (input) => {
			const url = typeof input === "string" ? input : input.toString();
			const body = url.includes("/alerts/rules")
				? { rules }
				: { evaluations: [] };
			return new Response(JSON.stringify(body), {
				headers: { "content-type": "application/json" },
			});
		};
		render(
			<ObsDashboardProvider basePath="/internal" fetcher={fetcher}>
				<AlertsDashboard />
			</ObsDashboardProvider>,
		);
		await screen.findByText("erroring rule");
		const error = screen.getByText("Error");
		expect(error.closest("[title]")?.getAttribute("title")).toBe(
			"metrics query matches 1200 series (limit 1000)",
		);
		expect(screen.getByText("No data")).toBeTruthy();
		expect(screen.getByText("Undelivered")).toBeTruthy();
	});
});
