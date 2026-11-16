import { buildAppsWildcardHost } from "@dokploy/server/services/domain";
import { describe, expect, it } from "vitest";

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
