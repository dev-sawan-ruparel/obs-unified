import { afterEach, describe, expect, it } from "vitest";
import {
	buildLineageAttributes,
	clearRecordedFeatureFlags,
	createResolveConfig,
	getRecordedFeatureFlags,
	initObservability,
	recordFeatureFlag,
	resolveLineageConfig,
	setConfiguredLineage,
	withFeatureFlagScope,
} from "./index";
import {
	createRequestSpan,
	runWithSpan,
	shutdownSpanExporter,
	withChildSpan,
} from "./span";

const getAttr = (
	attrs: Array<{ key: string; value?: Record<string, unknown> }> | undefined,
	key: string,
): unknown => {
	const found = attrs?.find((a) => a.key === key)?.value;
	if (!found) return undefined;
	return (
		found.stringValue ?? found.boolValue ?? found.intValue ?? found.doubleValue
	);
};

describe("RFC 0013 Goal 1.3 — telemetry-sdk runtime lineage & feature flags", () => {
	const originalEnv = { ...process.env };

	afterEach(async () => {
		process.env = { ...originalEnv };
		clearRecordedFeatureFlags();
		setConfiguredLineage(undefined);
		await shutdownSpanExporter();
	});

	it("resolves ObservabilityLineageConfig from explicit config and environment variables", () => {
		const env = {
			OBS_ENVIRONMENT: "staging",
			NODE_ENV: "production",
			OBS_SERVICE_VERSION: "1.2.3",
			GITHUB_SHA: "deadbeef1234",
			OBS_CONFIG_DIGEST: "cfg_abc123",
		};
		expect(resolveLineageConfig(undefined, env)).toEqual({
			environment: "staging",
			serviceVersion: "1.2.3",
			commitSha: "deadbeef1234",
			configDigest: "cfg_abc123",
		});

		expect(
			buildLineageAttributes(
				{
					environment: "prod",
					serviceVersion: "2.4.1",
					commitSha: "8f3a1b2",
					configDigest: "cfg_99a1",
				},
				env,
			),
		).toEqual({
			"deployment.environment.name": "prod",
			"obs.environment": "prod",
			"service.version": "2.4.1",
			"obs.service.version": "2.4.1",
			"vcs.commit.id": "8f3a1b2",
			"obs.commit.sha": "8f3a1b2",
			"obs.config.digest": "cfg_99a1",
		});
	});

	it("stamps lineage resource and span attributes when configured via initObservability", () => {
		initObservability({
			collectorUrl: "https://collector.example",
			apiKey: "key-1",
			serviceName: "checkout-api",
			environment: "prod",
			serviceVersion: "2.4.1",
			commitSha: "8f3a1b2",
			configDigest: "cfg_99a1",
			flushIntervalMs: 0,
		});

		const span = createRequestSpan("checkout-api", "POST /checkout");
		const exportReq = span.toOtlpExportRequest();
		const resourceAttrs = exportReq.resourceSpans?.[0]?.resource?.attributes;
		const spanAttrs =
			exportReq.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0]?.attributes;

		for (const attrs of [resourceAttrs, spanAttrs]) {
			expect(getAttr(attrs, "deployment.environment.name")).toBe("prod");
			expect(getAttr(attrs, "obs.environment")).toBe("prod");
			expect(getAttr(attrs, "service.version")).toBe("2.4.1");
			expect(getAttr(attrs, "obs.service.version")).toBe("2.4.1");
			expect(getAttr(attrs, "vcs.commit.id")).toBe("8f3a1b2");
			expect(getAttr(attrs, "obs.commit.sha")).toBe("8f3a1b2");
			expect(getAttr(attrs, "obs.config.digest")).toBe("cfg_99a1");
		}
	});

	it("wires lineage attributes into createResolveConfig for Workers", () => {
		const resolveConfig = createResolveConfig({
			defaultServiceName: "worker-api",
			lineage: {
				environment: "preview",
				serviceVersion: "3.0.0",
				commitSha: "abc1234",
				configDigest: "cfg_worker",
			},
		});
		const resolved = resolveConfig(
			{
				OTEL_EXPORTER_URL: "https://collector.example",
			},
			{},
		);
		expect(resolved.service).toEqual({
			name: "worker-api",
			version: "3.0.0",
		});
		expect(resolved.resource?.attributes).toEqual({
			"deployment.environment.name": "preview",
			"obs.environment": "preview",
			"service.version": "3.0.0",
			"obs.service.version": "3.0.0",
			"vcs.commit.id": "abc1234",
			"obs.commit.sha": "abc1234",
			"obs.config.digest": "cfg_worker",
		});
	});

	it("records feature flag evaluations on active span, emits evaluation event, and propagates to child spans", async () => {
		const requestSpan = createRequestSpan("checkout-api", "POST /pay");

		await runWithSpan(requestSpan, async () => {
			recordFeatureFlag("new_checkout_flow", true, {
				providerName: "openfeature",
				contextId: "user_42",
			});

			expect(getRecordedFeatureFlags()).toEqual({
				new_checkout_flow: true,
			});

			await withChildSpan("charge-card", async () => {
				recordFeatureFlag("retry_backoff_ms", 250);
			});
		});

		const exportReq = requestSpan.toOtlpExportRequest();
		const spans = exportReq.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
		const rootSpan = spans.find((s) => s.name === "POST /pay");
		const childSpan = spans.find((s) => s.name === "charge-card");

		expect(rootSpan).toBeDefined();
		expect(childSpan).toBeDefined();

		expect(getAttr(rootSpan?.attributes, "obs.feature_flags.new_checkout_flow")).toBe(
			true,
		);
		expect(getAttr(rootSpan?.attributes, "obs.feature_flags.retry_backoff_ms")).toBe(
			"250",
		);
		expect(getAttr(rootSpan?.attributes, "feature_flag.provider_name")).toBe(
			"openfeature",
		);
		expect(
			rootSpan?.events?.some((e) => e.name === "feature_flag.evaluation"),
		).toBe(true);

		expect(
			getAttr(childSpan?.attributes, "obs.feature_flags.new_checkout_flow"),
		).toBe(true);
		expect(
			getAttr(childSpan?.attributes, "obs.feature_flags.retry_backoff_ms"),
		).toBe("250");
		expect(getAttr(childSpan?.attributes, "feature_flag.key")).toBe(
			"retry_backoff_ms",
		);
		expect(getAttr(childSpan?.attributes, "feature_flag.variant")).toBe("250");
	});

	it("propagates feature flags recorded in scope before request span creation", () => {
		withFeatureFlagScope(() => {
			recordFeatureFlag("canary_router", "v2", { providerName: "flagd" });
			const span = createRequestSpan("router-svc", "GET /route");
			const exported =
				span.toOtlpExportRequest().resourceSpans?.[0]?.scopeSpans?.[0]
					?.spans?.[0];
			expect(getAttr(exported?.attributes, "feature_flag.key")).toBe(
				"canary_router",
			);
			expect(getAttr(exported?.attributes, "feature_flag.variant")).toBe("v2");
			expect(
				getAttr(exported?.attributes, "feature_flag.provider_name"),
			).toBe("flagd");
			expect(
				getAttr(exported?.attributes, "obs.feature_flags.canary_router"),
			).toBe("v2");
		});
	});
});
