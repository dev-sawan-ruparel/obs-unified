/**
 * SMTP transport for email alert channels on the Node collector.
 *
 *   ALERT_SMTP_HOST           SMTP server; setting it turns email channels on
 *   ALERT_SMTP_PORT           default 587 (starttls), 465 (tls), 25 (none)
 *   ALERT_SMTP_TLS            starttls (default) | tls | none
 *   ALERT_SMTP_FROM           envelope and From: address (required)
 *   ALERT_SMTP_USERNAME       AUTH user (optional; needs a password)
 *   ALERT_SMTP_PASSWORD       AUTH password, or
 *   ALERT_SMTP_PASSWORD_FILE  file holding it (trailing newline stripped)
 *
 * `starttls` refuses to send if the server does not offer STARTTLS; `tls`
 * opens TLS from the first byte; `none` sends in clear text. Certificates
 * are verified against Node's trust store (add a private CA with
 * NODE_EXTRA_CA_CERTS). The settings are host configuration: they never
 * reach a rule, the API or the logs.
 *
 * Partial configuration (a host without a sender, a username without a
 * password, an unknown TLS mode) is a startup error, not a silent fallback.
 */

import { readFileSync } from "node:fs";
import type {
	AlertEmailMessage,
	AlertEmailTransport,
} from "@obsunified/collector";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export type SmtpTlsMode = "starttls" | "tls" | "none";

export interface AlertSmtpConfig {
	host: string;
	port: number;
	tls: SmtpTlsMode;
	from: string;
	auth?: { user: string; pass: string };
}

const DEFAULT_PORTS: Record<SmtpTlsMode, number> = {
	starttls: 587,
	tls: 465,
	none: 25,
};

const ADDRESS_RE = /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+$/;

/**
 * Reads `ALERT_SMTP_*`. Returns null when `ALERT_SMTP_HOST` is unset (email
 * channels stay unavailable); throws on any incomplete or malformed setting.
 */
export function readAlertSmtpConfig(
	source: Record<string, string | undefined> = process.env,
	readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): AlertSmtpConfig | null {
	const get = (name: string) => {
		const v = source[name]?.trim();
		return v ? v : undefined;
	};
	const host = get("ALERT_SMTP_HOST");
	if (!host) {
		const stray = [
			"ALERT_SMTP_PORT",
			"ALERT_SMTP_TLS",
			"ALERT_SMTP_FROM",
			"ALERT_SMTP_USERNAME",
			"ALERT_SMTP_PASSWORD",
			"ALERT_SMTP_PASSWORD_FILE",
		].filter((k) => get(k));
		if (stray.length > 0)
			throw new Error(
				`${stray.join(", ")} set without ALERT_SMTP_HOST; set the host or remove them`,
			);
		return null;
	}

	const tlsRaw = (get("ALERT_SMTP_TLS") ?? "starttls").toLowerCase();
	if (tlsRaw !== "starttls" && tlsRaw !== "tls" && tlsRaw !== "none")
		throw new Error(
			`ALERT_SMTP_TLS="${tlsRaw}" is not supported; expected starttls, tls or none`,
		);
	const tls: SmtpTlsMode = tlsRaw;

	const portRaw = get("ALERT_SMTP_PORT");
	let port = DEFAULT_PORTS[tls];
	if (portRaw !== undefined) {
		if (
			!/^\d+$/.test(portRaw) ||
			Number(portRaw) < 1 ||
			Number(portRaw) > 65535
		)
			throw new Error(`ALERT_SMTP_PORT="${portRaw}" is not a TCP port`);
		port = Number(portRaw);
	}

	const from = get("ALERT_SMTP_FROM");
	if (!from)
		throw new Error("ALERT_SMTP_FROM is required with ALERT_SMTP_HOST");
	if (!ADDRESS_RE.test(from))
		throw new Error(
			`ALERT_SMTP_FROM="${from}" must be a plain address such as alerts@example.com`,
		);

	const user = get("ALERT_SMTP_USERNAME");
	const inlinePass = source.ALERT_SMTP_PASSWORD;
	const passFile = get("ALERT_SMTP_PASSWORD_FILE");
	if (inlinePass && passFile)
		throw new Error(
			"set ALERT_SMTP_PASSWORD or ALERT_SMTP_PASSWORD_FILE, not both",
		);
	let pass: string | undefined = inlinePass || undefined;
	if (passFile) {
		try {
			pass = readFile(passFile).replace(/\r?\n$/, "");
		} catch (err) {
			throw new Error(
				`ALERT_SMTP_PASSWORD_FILE could not be read: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		if (!pass) throw new Error("ALERT_SMTP_PASSWORD_FILE is empty");
	}
	if (user && !pass)
		throw new Error(
			"ALERT_SMTP_USERNAME needs ALERT_SMTP_PASSWORD or ALERT_SMTP_PASSWORD_FILE",
		);
	if (pass && !user)
		throw new Error("an SMTP password is set without ALERT_SMTP_USERNAME");

	return {
		host,
		port,
		tls,
		from,
		...(user && pass ? { auth: { user, pass } } : {}),
	};
}

/** One line for the startup log; never includes the password. */
export const describeAlertSmtpConfig = (c: AlertSmtpConfig): string =>
	`smtp://${c.host}:${c.port} (${c.tls}${c.auth ? `, auth as ${c.auth.user}` : ", no auth"}) from ${c.from}`;

export function createSmtpAlertEmailTransport(
	config: AlertSmtpConfig,
	/** Test-time additions to the TLS options (e.g. a CA for a local server). */
	overrides: { tls?: SMTPTransport.Options["tls"] } = {},
): AlertEmailTransport {
	const transporter = nodemailer.createTransport({
		host: config.host,
		port: config.port,
		secure: config.tls === "tls",
		requireTLS: config.tls === "starttls",
		ignoreTLS: config.tls === "none",
		auth: config.auth,
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 20_000,
		tls: { servername: config.host, ...overrides.tls },
	} satisfies SMTPTransport.Options);
	return {
		async send(message: AlertEmailMessage) {
			const info = await transporter.sendMail({
				from: config.from,
				to: message.to,
				subject: message.subject,
				text: message.text,
			});
			const rejected = (info.rejected ?? []).map(String);
			if (rejected.length > 0)
				throw new Error(
					`SMTP server rejected ${rejected.length} of ${message.to.length} recipients`,
				);
		},
	};
}
