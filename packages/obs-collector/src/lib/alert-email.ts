/**
 * Email alert channel: the runtime-neutral half.
 *
 * The collector package runs on Cloudflare Workers as well as Node, and a
 * Worker cannot open an SMTP connection. So the package only defines what an
 * email transport must do (`AlertEmailTransport`) and how an alert reads as
 * mail (`formatAlertEmail`); a host that can speak SMTP binds a transport as
 * `env.ALERT_EMAIL` (the Node collector does, from `ALERT_SMTP_*`, see
 * apps/collector-node/src/alert-email.ts). Without that binding, rules with
 * an email channel are refused at create/update time and an email channel on
 * an existing rule counts as a failed delivery at fire time.
 */

import type { AlertState } from "@obsunified/types";

export interface AlertEmailMessage {
	to: string[];
	subject: string;
	text: string;
}

export interface AlertEmailTransport {
	/**
	 * Sends one message. Resolves only when the SMTP server accepted it for
	 * every recipient; rejects otherwise.
	 */
	send(message: AlertEmailMessage): Promise<void>;
}

/** What every channel is told about a transition (the webhook JSON body). */
export interface AlertNotificationPayload {
	rule: {
		id: string;
		name: string;
		signal: string;
	};
	value: number;
	threshold: number;
	comparison: string;
	state: AlertState;
	evaluatedAt: string;
	projectId: string;
	/**
	 * RFC 0002 Stage 6 — populated when the rule is bound to an Analysis
	 * (`rule.analysisId` set). The narrative is the gated, LLM-generated
	 * sentence the dashboard panel was last showing — what's actually
	 * happening, in plain English. Webhooks consuming this can put the
	 * narrative in the Slack/PagerDuty body directly.
	 */
	analysis?: {
		id: string;
		narrative: string | null;
		status: string | null;
	};
}

export const MAX_EMAIL_RECIPIENTS = 20;

// Deliberately strict: one plain address, no display name, no whitespace,
// commas, angle brackets or quotes (nothing that could add a header or a
// second recipient).
const EMAIL_RE =
	/^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/;

export const isValidEmailAddress = (addr: string): boolean =>
	addr.length <= 254 && EMAIL_RE.test(addr);

const oneLine = (s: string): string => s.replace(/[\r\n]+/g, " ").trim();

export function formatAlertEmail(payload: AlertNotificationPayload): {
	subject: string;
	text: string;
} {
	const label = payload.state === "firing" ? "FIRING" : "RESOLVED";
	const name = oneLine(payload.rule.name);
	const lines = [
		payload.state === "firing"
			? `Alert rule "${name}" is firing.`
			: `Alert rule "${name}" has resolved.`,
		"",
		`Rule:        ${name} (${payload.rule.id})`,
		`Signal:      ${payload.rule.signal}`,
		`State:       ${payload.state}`,
		`Value:       ${payload.value}`,
		`Condition:   value ${payload.comparison} ${payload.threshold}`,
		`Threshold:   ${payload.threshold}`,
		`Comparison:  ${payload.comparison}`,
		`Evaluated:   ${payload.evaluatedAt}`,
		`Project:     ${payload.projectId}`,
	];
	if (payload.analysis) {
		lines.push(
			`Analysis:    ${payload.analysis.id}${payload.analysis.status ? ` (${payload.analysis.status})` : ""}`,
		);
		if (payload.analysis.narrative) {
			lines.push("", payload.analysis.narrative);
		}
	}
	lines.push("", "Sent by obs-unified.");
	return {
		subject: `[obs-unified] ${label}: ${name}`,
		text: `${lines.join("\n")}\n`,
	};
}
