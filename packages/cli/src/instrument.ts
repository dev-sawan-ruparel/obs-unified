import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import kleur from "kleur";

type PackageJson = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	scripts?: Record<string, string>;
};

type InstrumentFinding = {
	status: "ok" | "warn" | "missing";
	label: string;
	detail: string;
};

type InstrumentRecommendation = {
	title: string;
	body: string;
};

type InstrumentReport = {
	root: string;
	packageManager: string;
	detected: string[];
	findings: InstrumentFinding[];
	recommendations: InstrumentRecommendation[];
};

export async function runInstrument(args: string[]) {
	const options = parseInstrumentArgs(args);
	const report = await inspectInstrumentation(options.cwd, options);
	if (options.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	printInstrumentReport(report);
}

function parseInstrumentArgs(args: string[]) {
	let cwd = process.cwd();
	let collectorUrl = process.env.OBS_COLLECTOR_URL ?? "http://localhost:8790";
	let origin = "http://localhost:5173";
	let json = false;

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--cwd") {
			const value = args[i + 1];
			if (!value) {
				console.error(
					kleur.red("usage: obs-unified instrument [path] [--cwd <path>]"),
				);
				process.exit(1);
			}
			cwd = path.resolve(value);
			i += 1;
			continue;
		}
		if (arg.startsWith("--cwd=")) {
			cwd = path.resolve(arg.slice("--cwd=".length));
			continue;
		}
		if (arg === "--collector-url") {
			const value = args[i + 1];
			if (!value) {
				console.error(
					kleur.red(
						"usage: obs-unified instrument [path] [--collector-url <url>]",
					),
				);
				process.exit(1);
			}
			collectorUrl = value;
			i += 1;
			continue;
		}
		if (arg.startsWith("--collector-url=")) {
			collectorUrl = arg.slice("--collector-url=".length);
			continue;
		}
		if (arg === "--origin") {
			const value = args[i + 1];
			if (!value) {
				console.error(
					kleur.red("usage: obs-unified instrument [path] [--origin <origin>]"),
				);
				process.exit(1);
			}
			origin = value;
			i += 1;
			continue;
		}
		if (arg.startsWith("--origin=")) {
			origin = arg.slice("--origin=".length);
			continue;
		}
		if (arg.startsWith("-")) {
			console.error(kleur.red(`unknown instrument option: ${arg}`));
			process.exit(1);
		}
		cwd = path.resolve(arg);
	}

	return { cwd, collectorUrl, origin, json };
}

async function inspectInstrumentation(
	root: string,
	options: { collectorUrl: string; origin: string },
): Promise<InstrumentReport> {
	const packageJsonPath = path.join(root, "package.json");
	if (!existsSync(packageJsonPath)) {
		console.error(kleur.red(`no package.json found in ${root}`));
		process.exit(1);
	}

	const pkg = JSON.parse(
		await readFile(packageJsonPath, "utf8"),
	) as PackageJson;
	const allDeps = {
		...pkg.dependencies,
		...pkg.devDependencies,
		...pkg.peerDependencies,
	};
	const hasDep = (name: string) => Boolean(allDeps[name]);
	const files = await collectProjectFiles(root);
	const snippets = await readLikelySourceFiles(root, files);
	const contains = (needle: string) =>
		snippets.some(({ content }) => content.includes(needle));

	const packageManager = detectPackageManager(root);
	const detected = [
		hasDep("react") ? "React" : null,
		hasDep("vite") || existsSync(path.join(root, "vite.config.ts"))
			? "Vite"
			: null,
		hasDep("next") ? "Next.js" : null,
		hasDep("hono") || contains('from "hono"') || contains("from 'hono'")
			? "Hono"
			: null,
		hasDep("express") ||
		contains('from "express"') ||
		contains('require("express")')
			? "Express"
			: null,
		hasDep("fastify") || contains('from "fastify"') ? "Fastify" : null,
	]
		.filter(Boolean)
		.map(String);

	const frontend = detected.some((name) =>
		["React", "Vite", "Next.js"].includes(name),
	);
	const backend = detected.some((name) =>
		["Hono", "Express", "Fastify"].includes(name),
	);
	const analyticsInstalled = hasDep("@obs-unified/analytics-sdk");
	const telemetryInstalled = hasDep("@obs-unified/telemetry-sdk");
	const analyticsConfigured =
		contains("AnalyticsProvider") ||
		contains("new UsageTracker") ||
		contains("installAutoCorrelate");
	const telemetryConfigured =
		contains("initObservability") &&
		(contains("createRequestSpan") || contains("withChildSpan"));
	const interactionStamped = contains("stampInteractionFromRequest");
	const corsAllowsInteraction = snippets.some(
		({ content }) =>
			content.includes("x-obs-interaction") &&
			(content.includes("cors(") ||
				content.includes("Access-Control-Allow-Headers")),
	);

	const env = await readEnvLikeFiles(root);
	const envText = env.map(({ content }) => content).join("\n");
	const hasFrontendUrl =
		envText.includes("VITE_OBS_COLLECTOR_URL") ||
		envText.includes("NEXT_PUBLIC_OBS_COLLECTOR_URL");
	const hasFrontendKey =
		envText.includes("VITE_OBS_INGEST_KEY") ||
		envText.includes("NEXT_PUBLIC_OBS_INGEST_KEY");
	const hasBackendUrl = envText.includes("OBS_COLLECTOR_URL");
	const hasBackendKey = envText.includes("OBS_INGEST_KEY");
	const frontendEntry = firstExisting(files, [
		"src/main.tsx",
		"src/main.jsx",
		"pages/_app.tsx",
		"app/layout.tsx",
		"src/App.tsx",
	]);
	const backendEntry =
		snippets.find(({ content }) =>
			[
				'from "hono"',
				"from 'hono'",
				'from "express"',
				"from 'express'",
				'require("express")',
				'from "fastify"',
				"from 'fastify'",
			].some((needle) => content.includes(needle)),
		)?.file ??
		firstExisting(files, [
			"src/server.ts",
			"src/index.ts",
			"src/app.ts",
			"server.ts",
			"index.ts",
		]);

	const findings: InstrumentFinding[] = [];
	const addFinding = (
		status: InstrumentFinding["status"],
		label: string,
		detail: string,
	) => findings.push({ status, label, detail });

	addFinding(
		detected.length > 0 ? "ok" : "warn",
		"project shape",
		detected.length > 0
			? detected.join(", ")
			: "No supported framework detected yet. The scanner currently recognizes React, Vite, Next.js, Hono, Express, and Fastify.",
	);
	if (frontend) {
		addFinding(
			analyticsInstalled ? "ok" : "missing",
			"browser SDK package",
			analyticsInstalled
				? "@obs-unified/analytics-sdk is installed"
				: `${installCommand(packageManager, "@obs-unified/analytics-sdk")}`,
		);
		addFinding(
			analyticsConfigured ? "ok" : "missing",
			"browser SDK wiring",
			analyticsConfigured
				? "Analytics provider/tracker wiring was found"
				: "Wrap the app entry with AnalyticsProvider or initialize UsageTracker in the browser entry.",
		);
		addFinding(
			hasFrontendUrl && hasFrontendKey ? "ok" : "missing",
			"browser env",
			frontendEnvHint(detected, options.collectorUrl),
		);
	}
	if (backend) {
		addFinding(
			telemetryInstalled ? "ok" : "missing",
			"backend SDK package",
			telemetryInstalled
				? "@obs-unified/telemetry-sdk is installed"
				: `${installCommand(packageManager, "@obs-unified/telemetry-sdk")}`,
		);
		addFinding(
			telemetryConfigured ? "ok" : "missing",
			"backend SDK wiring",
			telemetryConfigured
				? "initObservability and span creation were found"
				: "Initialize telemetry once and wrap inbound requests in a root span.",
		);
		addFinding(
			interactionStamped ? "ok" : "missing",
			"click-to-trace propagation",
			interactionStamped
				? "stampInteractionFromRequest was found"
				: "Call stampInteractionFromRequest on the request root span.",
		);
		addFinding(
			corsAllowsInteraction ? "ok" : "missing",
			"CORS interaction header",
			corsAllowsInteraction
				? "x-obs-interaction appears in CORS allow headers"
				: `Allow x-obs-interaction for browser requests from ${options.origin}.`,
		);
		addFinding(
			hasBackendUrl && hasBackendKey ? "ok" : "missing",
			"backend env",
			`OBS_COLLECTOR_URL=${options.collectorUrl} and OBS_INGEST_KEY=<write-only key>`,
		);
	}

	const recommendations = buildInstrumentRecommendations({
		detected,
		frontend,
		backend,
		analyticsInstalled,
		telemetryInstalled,
		analyticsConfigured,
		telemetryConfigured,
		interactionStamped,
		corsAllowsInteraction,
		hasFrontendEnv: hasFrontendUrl && hasFrontendKey,
		hasBackendEnv: hasBackendUrl && hasBackendKey,
		packageManager,
		collectorUrl: options.collectorUrl,
		origin: options.origin,
		files,
		frontendEntry,
		backendEntry,
	});

	return { root, packageManager, detected, findings, recommendations };
}

async function collectProjectFiles(root: string) {
	const ignored = new Set([
		".git",
		".next",
		"coverage",
		"dist",
		"build",
		"node_modules",
		"out",
	]);
	const files: string[] = [];
	const visit = async (dir: string, depth: number) => {
		if (depth > 5 || files.length > 1000) return;
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (ignored.has(entry.name)) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await visit(full, depth + 1);
			} else if (/\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(entry.name)) {
				files.push(path.relative(root, full));
			}
		}
	};
	await visit(root, 0);
	return files;
}

async function readLikelySourceFiles(root: string, files: string[]) {
	const likely = files
		.filter(
			(file) =>
				file.startsWith("src/") ||
				file.startsWith("app/") ||
				file.startsWith("pages/"),
		)
		.slice(0, 200);
	const out: Array<{ file: string; content: string }> = [];
	for (const file of likely) {
		try {
			out.push({
				file,
				content: await readFile(path.join(root, file), "utf8"),
			});
		} catch {
			// Ignore unreadable generated files; the scanner is advisory.
		}
	}
	return out;
}

async function readEnvLikeFiles(root: string) {
	const candidates = [
		".env",
		".env.local",
		".env.example",
		".dev.vars",
		"wrangler.toml",
	];
	const out: Array<{ file: string; content: string }> = [];
	for (const file of candidates) {
		const full = path.join(root, file);
		if (!existsSync(full)) continue;
		out.push({ file, content: await readFile(full, "utf8") });
	}
	return out;
}

function detectPackageManager(root: string) {
	if (existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(path.join(root, "yarn.lock"))) return "yarn";
	if (existsSync(path.join(root, "bun.lockb"))) return "bun";
	return "npm";
}

function installCommand(packageManager: string, pkg: string) {
	if (packageManager === "yarn") return `yarn add ${pkg}`;
	if (packageManager === "bun") return `bun add ${pkg}`;
	if (packageManager === "npm") return `npm install ${pkg}`;
	return `pnpm add ${pkg}`;
}

function frontendEnvHint(detected: string[], collectorUrl: string) {
	if (detected.includes("Next.js")) {
		return `NEXT_PUBLIC_OBS_COLLECTOR_URL=${collectorUrl} and NEXT_PUBLIC_OBS_INGEST_KEY=<write-only key>`;
	}
	return `VITE_OBS_COLLECTOR_URL=${collectorUrl} and VITE_OBS_INGEST_KEY=<write-only key>`;
}

function firstExisting(files: string[], candidates: string[]) {
	return (
		candidates.find((candidate) => files.includes(candidate)) ?? candidates[0]
	);
}

function buildInstrumentRecommendations(input: {
	detected: string[];
	frontend: boolean;
	backend: boolean;
	analyticsInstalled: boolean;
	telemetryInstalled: boolean;
	analyticsConfigured: boolean;
	telemetryConfigured: boolean;
	interactionStamped: boolean;
	corsAllowsInteraction: boolean;
	hasFrontendEnv: boolean;
	hasBackendEnv: boolean;
	packageManager: string;
	collectorUrl: string;
	origin: string;
	files: string[];
	frontendEntry: string;
	backendEntry: string;
}) {
	const recommendations: InstrumentRecommendation[] = [];
	const packages = [
		input.frontend && !input.analyticsInstalled
			? "@obs-unified/analytics-sdk"
			: null,
		input.backend && !input.telemetryInstalled
			? "@obs-unified/telemetry-sdk"
			: null,
	]
		.filter(Boolean)
		.map(String);
	if (packages.length > 0) {
		recommendations.push({
			title: "Install missing SDK packages",
			body: installCommand(input.packageManager, packages.join(" ")),
		});
	}
	if (input.frontend && !input.analyticsConfigured) {
		const collectorEnv = input.detected.includes("Next.js")
			? "process.env.NEXT_PUBLIC_OBS_COLLECTOR_URL"
			: "import.meta.env.VITE_OBS_COLLECTOR_URL";
		const keyEnv = input.detected.includes("Next.js")
			? "process.env.NEXT_PUBLIC_OBS_INGEST_KEY"
			: "import.meta.env.VITE_OBS_INGEST_KEY";
		recommendations.push({
			title: `Wire browser analytics in ${input.frontendEntry}`,
			body: `Import AnalyticsProvider from @obs-unified/analytics-sdk/react and wrap your root component:

<AnalyticsProvider
  collectorUrl={${collectorEnv}}
  apiKey={${keyEnv}}
  trackPageViews
  captureErrors
>
  <App />
</AnalyticsProvider>`,
		});
	}
	if (input.backend && !input.telemetryConfigured) {
		recommendations.push({
			title: `Create request spans in ${input.backendEntry}`,
			body: `Initialize once:

initObservability({
  collectorUrl: process.env.OBS_COLLECTOR_URL!,
  apiKey: process.env.OBS_INGEST_KEY!,
  serviceName: "my-service",
});

For each request, create a root span, run the handler inside it, end it, and flush spans/logs before the response lifecycle exits.`,
		});
	}
	if (input.backend && !input.interactionStamped) {
		recommendations.push({
			title: "Preserve click-to-trace context",
			body: `After creating the request root span, call:

stampInteractionFromRequest(span, request);

For Hono this is usually stampInteractionFromRequest(span, c.req.raw).`,
		});
	}
	if (input.backend && !input.corsAllowsInteraction) {
		recommendations.push({
			title: "Allow obs-unified browser headers in CORS",
			body: `Allow requests from ${input.origin} and include at least:

Content-Type, Authorization, x-obs-interaction, x-obs-session-id`,
		});
	}
	const envLines = [
		input.frontend && !input.hasFrontendEnv
			? frontendEnvHint(input.detected, input.collectorUrl)
			: null,
		input.backend && !input.hasBackendEnv
			? `OBS_COLLECTOR_URL=${input.collectorUrl}\nOBS_INGEST_KEY=<write-only key>`
			: null,
	].filter(Boolean);
	if (envLines.length > 0) {
		recommendations.push({
			title: "Add environment values",
			body: envLines.join("\n"),
		});
	}
	recommendations.push({
		title: "Verify the collector path",
		body: `obs-unified doctor ${input.collectorUrl} --origin ${input.origin}`,
	});
	return recommendations;
}

function printInstrumentReport(report: InstrumentReport) {
	console.log(`${kleur.bold("Instrumentation scan")}`);
	console.log(`Project: ${report.root}`);
	console.log(`Package manager: ${report.packageManager}`);
	console.log(
		`Detected: ${report.detected.length > 0 ? report.detected.join(", ") : "unknown"}\n`,
	);
	for (const finding of report.findings) {
		const icon =
			finding.status === "ok"
				? kleur.green("✓")
				: finding.status === "warn"
					? kleur.yellow("!")
					: kleur.red("✗");
		console.log(`  ${icon} ${finding.label} — ${finding.detail}`);
	}
	console.log();
	console.log(kleur.bold("Recommended next steps"));
	for (const [index, recommendation] of report.recommendations.entries()) {
		console.log(`\n${index + 1}. ${recommendation.title}`);
		console.log(recommendation.body);
	}
}
