import { buildAppsWildcardHost } from "@dokploy/server/services/domain";
import {
	generateRandomDomain,
	isAppsWildcardHost,
} from "@dokploy/server/templates";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("buildAppsWildcardHost", () => {
	it("prefixes the wildcard domain with the app name", () => {
		expect(buildAppsWildcardHost("my-api-x1y2z3", "apps.ktc-org.com")).toBe(
			"my-api-x1y2z3.apps.ktc-org.com",
		);
	});

	it("accepts the wildcard written with a leading *. or a trailing dot", () => {
		expect(buildAppsWildcardHost("web", "*.apps.ktc-org.com")).toBe(
			"web.apps.ktc-org.com",
		);
		expect(buildAppsWildcardHost("web", " apps.ktc-org.com. ")).toBe(
			"web.apps.ktc-org.com",
		);
	});

	it("lowercases the result", () => {
		expect(buildAppsWildcardHost("My-App", "Apps.KTC-org.com")).toBe(
			"my-app.apps.ktc-org.com",
		);
	});

	it("keeps the app label within the 63-character DNS limit", () => {
		const host = buildAppsWildcardHost(
			`${"a".repeat(62)}-b`,
			"apps.ktc-org.com",
		);
		const label = host.split(".")[0] ?? "";
		expect(label.length).toBeLessThanOrEqual(63);
		expect(label.endsWith("-")).toBe(false);
	});
});

describe("generated domains with APPS_WILDCARD_DOMAIN", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses the wildcard domain instead of sslip.io", () => {
		vi.stubEnv("APPS_WILDCARD_DOMAIN", "*.apps.ktc-org.com");
		const host = generateRandomDomain({
			serverIp: "45.81.7.27",
			projectName: "test-adminer",
		});
		expect(host).toMatch(/^test-adminer-[0-9a-f]{6}\.apps\.ktc-org\.com$/);
	});

	it("keeps sslip.io when the variable is not set", () => {
		vi.stubEnv("APPS_WILDCARD_DOMAIN", "");
		const host = generateRandomDomain({
			serverIp: "45.81.7.27",
			projectName: "test-adminer",
		});
		expect(host).toMatch(/^test-adminer-[0-9a-f]{6}-45-81-7-27\.sslip\.io$/);
	});

	it("keeps the label within the 63-character DNS limit", () => {
		vi.stubEnv("APPS_WILDCARD_DOMAIN", "apps.ktc-org.com");
		const host = generateRandomDomain({
			serverIp: "",
			projectName: "x".repeat(80),
		});
		expect((host.split(".")[0] ?? "").length).toBeLessThanOrEqual(63);
	});

	it("recognises hosts under the wildcard domain only", () => {
		vi.stubEnv("APPS_WILDCARD_DOMAIN", "apps.ktc-org.com");
		expect(isAppsWildcardHost("web-abc123.apps.ktc-org.com")).toBe(true);
		expect(isAppsWildcardHost("panel.ktc-org.com")).toBe(false);
		expect(isAppsWildcardHost("evilapps.ktc-org.com")).toBe(false);
	});
});
