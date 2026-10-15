import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildLineageAttributes,
	buildResourceAttributes,
	clearRecordedFeatureFlags,
	getRecordedFeatureFlags,
	recordFeatureFlag,
	setConfiguredLineage,
	stampActiveFeatureFlagsAndLineage,
	withFeatureFlagScope,
} from "./index.js";

describe("RFC 0013 Goal 1.3 — @obsunified/sdk runtime lineage & feature flags", () => {
	afterEach(() => {
		clearRecordedFeatureFlags();
		setConfiguredLineage(undefined);
		vi.restoreAllMocks();
	});

	it("builds resource attributes from InitConfig and environment variables", () => {
		const attrs = buildResourceAttributes(
			{
				collectorUrl: "https://collector.example",
				ingestKey: "key-1",
				serviceName: "payments-node",
				environment: "prod",
				serviceVersion: "2.4.1",
				commitSha: "8f3a1b2",
				configDigest: "cfg_99a1",
			},
			{},
		);

		expect(attrs).toMatchObject({
			"service.name": "payments-node",
			"deployment.environment": "prod",
			"deployment.environment.name": "prod",
			"obs.environment": "prod",
			"service.version": "2.4.1",
			"obs.service.version": "2.4.1",
			"vcs.commit.id": "8f3a1b2",
			"obs.commit.sha": "8f3a1b2",
			"obs.config.digest": "cfg_99a1",
		});

		const envResolved = buildLineageAttributes(undefined, {
			OBS_ENVIRONMENT: "staging",
			OBS_SERVICE_VERSION: "1.9.0",
			GITHUB_SHA: "deadbeef",
			OBS_CONFIG_DIGEST: "cfg_env",
		});
		expect(envResolved).toEqual({
			"deployment.environment": "staging",
			"deployment.environment.name": "staging",
			"obs.environment": "staging",
			"service.version": "1.9.0",
			"obs.service.version": "1.9.0",
			"vcs.commit.id": "deadbeef",
			"obs.commit.sha": "deadbeef",
			"obs.config.digest": "cfg_env",
		});
	});

	it("records feature flag evaluations on the active OTel span and active scope", () => {
		const attrs = new Map<string, unknown>();
		const events: Array<{ name: string; attributes?: Record<string, unknown> }> =
			[];
		const mockSpan = {
			isRecording: () => true,
			setAttribute: (k: string, v: unknown) => {
				attrs.set(k, v);
			},
			addEvent: (name: string, eventAttrs?: Record<string, unknown>) => {
				events.push({ name, attributes: eventAttrs });
			},
		};

		vi.spyOn(trace, "getActiveSpan").mockReturnValue(mockSpan as never);

		withFeatureFlagScope(() => {
			recordFeatureFlag("fast_settlement", true, {
				providerName: "openfeature",
				contextId: "merchant_99",
			});

			expect(getRecordedFeatureFlags()).toEqual({
				fast_settlement: true,
			});

			expect(attrs.get("feature_flag.key")).toBe("fast_settlement");
			expect(attrs.get("feature_flag.variant")).toBe("true");
			expect(attrs.get("feature_flag.provider_name")).toBe("openfeature");
			expect(attrs.get("feature_flag.context.id")).toBe("merchant_99");
			expect(attrs.get("obs.feature_flags.fast_settlement")).toBe(true);
			expect(events).toEqual([
				{
					name: "feature_flag.evaluation",
					attributes: {
						"feature_flag.key": "fast_settlement",
						"feature_flag.variant": "true",
						"feature_flag.provider_name": "openfeature",
						"feature_flag.context.id": "merchant_99",
					},
				},
			]);

			const childAttrs = new Map<string, unknown>();
			const childSpan = {
				isRecording: () => true,
				setAttribute: (k: string, v: unknown) => {
					childAttrs.set(k, v);
				},
			};
			stampActiveFeatureFlagsAndLineage(childSpan as never, {
				environment: "prod",
				commitSha: "8f3a1b2",
			});
			expect(childAttrs.get("obs.feature_flags.fast_settlement")).toBe(true);
			expect(childAttrs.get("obs.commit.sha")).toBe("8f3a1b2");
			expect(childAttrs.get("vcs.commit.id")).toBe("8f3a1b2");
		});
	});
});
