import type { AlertRuleInput, AlertTestResponse } from "@obs/types";
import type { CollectorPlugin } from "../framework/collector";
import { AlertsStore, compareValue } from "../lib/alerts-store";
import { getProjectId } from "./_context";

export const alertsRoutesPlugin: CollectorPlugin = {
	name: "alerts-routes",
	register(app) {
		app.get("/internal/alerts/rules", async (c) => {
			const projectId = getProjectId(c);
			const store = new AlertsStore(c.env.DB);
			const rules = await store.listRules(projectId);
			return c.json({ rules });
		});

		app.post("/internal/alerts/rules", async (c) => {
			const projectId = getProjectId(c);
			let input: AlertRuleInput;
			try {
				input = await c.req.json<AlertRuleInput>();
			} catch {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			const store = new AlertsStore(c.env.DB);
			try {
				const rule = await store.createRule(projectId, input);
				return c.json({ rule }, 201);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return c.json({ error: message }, 400);
			}
		});

		app.patch("/internal/alerts/rules/:id", async (c) => {
			const projectId = getProjectId(c);
			const id = c.req.param("id");
			let patch: Partial<AlertRuleInput>;
			try {
				patch = await c.req.json<Partial<AlertRuleInput>>();
			} catch {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			const store = new AlertsStore(c.env.DB);
			try {
				const rule = await store.updateRule(id, projectId, patch);
				if (!rule) return c.json({ error: "Rule not found" }, 404);
				return c.json({ rule });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return c.json({ error: message }, 400);
			}
		});

		app.delete("/internal/alerts/rules/:id", async (c) => {
			const projectId = getProjectId(c);
			const id = c.req.param("id");
			const store = new AlertsStore(c.env.DB);
			const deleted = await store.deleteRule(id, projectId);
			if (!deleted) return c.json({ error: "Rule not found" }, 404);
			return c.json({ success: true });
		});

		app.get("/internal/alerts/evaluations", async (c) => {
			const ruleId = c.req.query("ruleId");
			if (!ruleId) return c.json({ error: "ruleId is required" }, 400);
			const hours = Math.max(
				1,
				Math.min(720, Number.parseInt(c.req.query("hours") || "24", 10) || 24),
			);
			const store = new AlertsStore(c.env.DB);
			const evaluations = await store.listEvaluations({ ruleId, hours });
			return c.json({ evaluations });
		});

		app.post("/internal/alerts/rules/:id/test", async (c) => {
			const projectId = getProjectId(c);
			const id = c.req.param("id");
			const store = new AlertsStore(c.env.DB);
			const rule = await store.getRule(id, projectId);
			if (!rule) return c.json({ error: "Rule not found" }, 404);
			const value = await store.evaluateRule(rule);
			const response: AlertTestResponse = {
				value,
				wouldFire: compareValue(value, rule.threshold, rule.comparison),
				comparison: rule.comparison,
				threshold: rule.threshold,
			};
			return c.json(response);
		});
	},
};
