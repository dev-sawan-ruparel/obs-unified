/**
 * Email alert channel on the Node collector: SMTP settings, and real sends
 * over STARTTLS + AUTH to an SMTP server started in-process (`smtp-server`,
 * with a certificate generated for the run), through nodemailer and the
 * collector's own evaluator.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import {
	type AlertEmailTransport,
	AlertsStore,
	evaluateRuleBatch,
} from "@obsunified/collector";
import type { AlertRule } from "@obsunified/types";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createSmtpAlertEmailTransport,
	describeAlertSmtpConfig,
	readAlertSmtpConfig,
} from "./alert-email.ts";

const logger = { debug() {}, info() {}, warn() {}, error() {} };

const must = <T>(v: T | null): T => {
	if (v === null) throw new Error("expected a value");
	return v;
};

describe("readAlertSmtpConfig", () => {
	it("is off without ALERT_SMTP_HOST", () => {
		expect(readAlertSmtpConfig({})).toBeNull();
	});

	it("refuses SMTP settings without a host", () => {
		expect(() =>
			readAlertSmtpConfig({ ALERT_SMTP_FROM: "alerts@example.com" }),
		).toThrow(/ALERT_SMTP_FROM set without ALERT_SMTP_HOST/);
	});

	it("defaults to STARTTLS on 587 and reads a password file", () => {
		const config = readAlertSmtpConfig(
			{
				ALERT_SMTP_HOST: "smtp.example.com",
				ALERT_SMTP_FROM: "alerts@example.com",
				ALERT_SMTP_USERNAME: "alerts",
				ALERT_SMTP_PASSWORD_FILE: "/run/secrets/smtp",
			},
			(p) => {
				expect(p).toBe("/run/secrets/smtp");
				return "s3cret\n";
			},
		);
		expect(config).toEqual({
			host: "smtp.example.com",
			port: 587,
			tls: "starttls",
			from: "alerts@example.com",
			auth: { user: "alerts", pass: "s3cret" },
		});
		expect(describeAlertSmtpConfig(must(config))).not.toContain("s3cret");
	});

	it("uses 465 for tls and 25 for none unless a port is given", () => {
		const base = {
			ALERT_SMTP_HOST: "smtp.example.com",
			ALERT_SMTP_FROM: "a@example.com",
		};
		expect(readAlertSmtpConfig({ ...base, ALERT_SMTP_TLS: "tls" })?.port).toBe(
			465,
		);
		expect(readAlertSmtpConfig({ ...base, ALERT_SMTP_TLS: "NONE" })?.port).toBe(
			25,
		);
		expect(
			readAlertSmtpConfig({ ...base, ALERT_SMTP_PORT: "2525" })?.port,
		).toBe(2525);
	});

	it("rejects incomplete or malformed settings", () => {
		const base = {
			ALERT_SMTP_HOST: "smtp.example.com",
			ALERT_SMTP_FROM: "a@example.com",
		};
		const cases: Array<[Record<string, string>, RegExp]> = [
			[{ ALERT_SMTP_HOST: "smtp.example.com" }, /ALERT_SMTP_FROM is required/],
			[{ ...base, ALERT_SMTP_FROM: "Alerts <a@x.com>" }, /plain address/],
			[{ ...base, ALERT_SMTP_TLS: "ssl" }, /ALERT_SMTP_TLS="ssl"/],
			[{ ...base, ALERT_SMTP_PORT: "70000" }, /not a TCP port/],
			[{ ...base, ALERT_SMTP_USERNAME: "u" }, /needs ALERT_SMTP_PASSWORD/],
			[{ ...base, ALERT_SMTP_PASSWORD: "p" }, /without ALERT_SMTP_USERNAME/],
			[
				{
					...base,
					ALERT_SMTP_USERNAME: "u",
					ALERT_SMTP_PASSWORD: "p",
					ALERT_SMTP_PASSWORD_FILE: "/x",
				},
				/not both/,
			],
		];
		for (const [env, message] of cases) {
			expect(() => readAlertSmtpConfig(env)).toThrow(message);
		}
		expect(() =>
			readAlertSmtpConfig(
				{ ...base, ALERT_SMTP_USERNAME: "u", ALERT_SMTP_PASSWORD_FILE: "/x" },
				() => {
					throw new Error("ENOENT");
				},
			),
		).toThrow(/could not be read: ENOENT/);
	});
});

interface Received {
	from: string | false;
	to: string[];
	user: string | undefined;
	secure: boolean;
	raw: string;
}

describe("SMTP delivery (in-process server, STARTTLS + AUTH)", () => {
	let dir: string;
	let server: SMTPServer;
	let port: number;
	let ca: string;
	const received: Received[] = [];

	beforeAll(async () => {
		// A certificate for "localhost" so the client verifies TLS for real.
		dir = mkdtempSync(path.join(os.tmpdir(), "obs-smtp-test-"));
		const keyPath = path.join(dir, "key.pem");
		const certPath = path.join(dir, "cert.pem");
		const cnfPath = path.join(dir, "openssl.cnf");
		writeFileSync(
			cnfPath,
			[
				"[req]",
				"distinguished_name=dn",
				"x509_extensions=ext",
				"prompt=no",
				"[dn]",
				"CN=localhost",
				"[ext]",
				"subjectAltName=DNS:localhost,IP:127.0.0.1",
				"basicConstraints=critical,CA:TRUE",
				"",
			].join("\n"),
		);
		execFileSync(
			"openssl",
			[
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-days",
				"2",
				"-keyout",
				keyPath,
				"-out",
				certPath,
				"-config",
				cnfPath,
			],
			{ stdio: "ignore" },
		);
		ca = readFileSync(certPath, "utf8");
		server = new SMTPServer({
			key: readFileSync(keyPath),
			cert: ca,
			authMethods: ["PLAIN", "LOGIN"],
			logger: false,
			onAuth(auth, _session, callback) {
				if (auth.username === "alerts" && auth.password === "s3cret")
					return callback(null, { user: auth.username });
				return callback(new Error("Invalid username or password"));
			},
			onRcptTo(address, _session, callback) {
				if (address.address.endsWith("@refused.example"))
					return callback(new Error("mailbox unavailable"));
				return callback();
			},
			onData(stream, session, callback) {
				const chunks: Buffer[] = [];
				stream.on("data", (c: Buffer) => chunks.push(c));
				stream.on("end", () => {
					received.push({
						from: session.envelope.mailFrom
							? session.envelope.mailFrom.address
							: false,
						to: session.envelope.rcptTo.map((r) => r.address),
						user: session.user as string | undefined,
						secure: session.secure,
						raw: Buffer.concat(chunks).toString("utf8"),
					});
					callback();
				});
			},
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", () => resolve()),
		);
		port = (server.server.address() as AddressInfo).port;
	});

	afterAll(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(dir, { recursive: true, force: true });
	});

	const transportFor = (pass = "s3cret"): AlertEmailTransport => {
		const config = readAlertSmtpConfig({
			ALERT_SMTP_HOST: "localhost",
			ALERT_SMTP_PORT: String(port),
			ALERT_SMTP_FROM: "alerts@obs.example",
			ALERT_SMTP_USERNAME: "alerts",
			ALERT_SMTP_PASSWORD: pass,
		});
		if (!config) throw new Error("config expected");
		return createSmtpAlertEmailTransport(config, { tls: { ca } });
	};

	it("sends over STARTTLS with AUTH", async () => {
		received.length = 0;
		await transportFor().send({
			to: ["oncall@example.com"],
			subject: "hello",
			text: "body line\n",
		});
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			from: "alerts@obs.example",
			to: ["oncall@example.com"],
			user: "alerts",
			secure: true,
		});
		expect(received[0].raw).toContain("Subject: hello");
		expect(received[0].raw).toContain("body line");
	});

	it("rejects when authentication fails", async () => {
		await expect(
			transportFor("wrong").send({
				to: ["oncall@example.com"],
				subject: "x",
				text: "x",
			}),
		).rejects.toThrow(/Invalid username or password|EAUTH/i);
	});

	it("rejects when the server refuses a recipient", async () => {
		await expect(
			transportFor().send({
				to: ["oncall@example.com", "nobody@refused.example"],
				subject: "x",
				text: "x",
			}),
		).rejects.toThrow(/rejected 1 of 2 recipients|mailbox unavailable/);
	});

	it("refuses a server that does not offer STARTTLS", async () => {
		const plain = new SMTPServer({
			disabledCommands: ["STARTTLS", "AUTH"],
			logger: false,
			onData(stream, _s, cb) {
				stream.resume();
				stream.on("end", () => cb());
			},
		});
		await new Promise<void>((r) => plain.listen(0, "127.0.0.1", () => r()));
		try {
			const config = readAlertSmtpConfig({
				ALERT_SMTP_HOST: "localhost",
				ALERT_SMTP_PORT: String((plain.server.address() as AddressInfo).port),
				ALERT_SMTP_FROM: "alerts@obs.example",
			});
			await expect(
				createSmtpAlertEmailTransport(must(config)).send({
					to: ["oncall@example.com"],
					subject: "x",
					text: "x",
				}),
			).rejects.toThrow(/STARTTLS/i);
		} finally {
			await new Promise<void>((r) => plain.close(() => r()));
		}
	});

	it("delivers firing and resolved emails from the alert evaluator", async () => {
		received.length = 0;
		const rule: AlertRule = {
			id: "rule-email",
			projectId: "default",
			name: "Voice errors",
			signal: "metrics",
			query: { metric: "vbox_errors_total", aggregation: "increase" },
			threshold: 0,
			windowMins: 5,
			comparison: ">",
			channels: [{ type: "email", to: ["oncall@example.com"] }],
			enabled: true,
			createdAt: "2026-10-31T00:00:00.000Z",
			updatedAt: "2026-10-31T00:00:00.000Z",
			analysisId: null,
			pendingSecs: 0,
		};
		let value = 3;
		let state: {
			current_state: "ok" | "firing";
			last_state_change: string;
			notified: number;
		} | null = null;
		const store = {
			listEnabledRules: async () => [rule],
			evaluateRule: async () => value,
			getState: async () => state,
			setPending: async () => {},
			transitionState: async (
				_r: string,
				_p: string,
				next: "ok" | "firing",
				now: string,
			) => {
				state = { current_state: next, last_state_change: now, notified: 0 };
			},
			markNotified: async () => {
				if (state) state.notified = 1;
				return true;
			},
			getAnalysisNarrative: async () => null,
			recordEvaluation: async () => {},
		};
		const email = transportFor();

		const fired = await evaluateRuleBatch(store, [rule], { logger, email });
		expect(fired.fired).toBe(1);
		value = 0;
		const resolved = await evaluateRuleBatch(store, [rule], { logger, email });
		expect(resolved.resolved).toBe(1);

		expect(received).toHaveLength(2);
		expect(received.every((m) => m.secure && m.user === "alerts")).toBe(true);
		const [firing, ok] = received.map((m) => m.raw);
		expect(firing).toContain("Subject: [obs-unified] FIRING: Voice errors");
		expect(firing).toContain("Signal:      metrics");
		expect(firing).toContain("Value:       3");
		expect(firing).toContain("Condition:   value > 0");
		expect(ok).toContain("Subject: [obs-unified] RESOLVED: Voice errors");
		expect(ok).toContain("State:       ok");
		expect(state).toMatchObject({ current_state: "ok", notified: 1 });
	});

	it("leaves the notification owed when the SMTP server is unreachable", async () => {
		const config = readAlertSmtpConfig({
			ALERT_SMTP_HOST: "localhost",
			ALERT_SMTP_PORT: "1",
			ALERT_SMTP_FROM: "alerts@obs.example",
		});
		const errors: string[] = [];
		const rule: AlertRule = {
			id: "rule-down",
			projectId: "default",
			name: "down",
			signal: "spans",
			query: {},
			threshold: 0,
			windowMins: 5,
			comparison: ">",
			channels: [{ type: "email", to: ["oncall@example.com"] }],
			enabled: true,
			createdAt: "2026-10-31T00:00:00.000Z",
			updatedAt: "2026-10-31T00:00:00.000Z",
		};
		const evaluations: boolean[] = [];
		let notified = 0;
		const result = await evaluateRuleBatch(
			{
				listEnabledRules: async () => [rule],
				evaluateRule: async () => 1,
				getState: async () => null,
				setPending: async () => {},
				transitionState: async () => {},
				markNotified: async () => {
					notified += 1;
					return true;
				},
				getAnalysisNarrative: async () => null,
				recordEvaluation: async (_r, _p, _v, _s, ok) => {
					evaluations.push(ok);
				},
			},
			[rule],
			{
				logger: { ...logger, error: (m: string) => errors.push(m) },
				email: createSmtpAlertEmailTransport(must(config)),
			},
		);
		expect(result.fired).toBe(1);
		expect(notified).toBe(0);
		expect(evaluations).toEqual([false]);
		expect(errors).toContain("[alerts-evaluator] email delivery failed");
	});

	it("refuses email rules on a collector without SMTP", async () => {
		const { createMigratedSqliteDb } = await import(
			"../../../packages/obs-collector/src/lib/test-utils/node-sqlite-db.ts"
		);
		const db = createMigratedSqliteDb();
		const input = {
			name: "mail",
			signal: "spans" as const,
			query: {},
			threshold: 1,
			windowMins: 5,
			comparison: ">" as const,
			channels: [{ type: "email" as const, to: ["oncall@example.com"] }],
		};
		expect(() => new AlertsStore(db).validateInput(input)).toThrow(
			/email channels need SMTP configured on the collector/,
		);
		expect(() =>
			new AlertsStore(db, { emailDeliveryAvailable: true }).validateInput(
				input,
			),
		).not.toThrow();
		db.close();
	});
});
