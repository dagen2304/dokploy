import { readFileSync } from "node:fs";
import path from "node:path";
import { ROUTER_POLICY } from "@dokploy/server/services/olympe/guard";
import { describe, expect, it } from "vitest";

// A router added upstream must be classified before clients can use it.
describe("ROUTER_POLICY", () => {
	const root = readFileSync(
		path.resolve(__dirname, "../../server/api/root.ts"),
		"utf8",
	);
	const body = root.slice(root.indexOf("createTRPCRouter({"));
	const keys = [...body.matchAll(/^\t(\w+): \w+Router,/gm)].map(
		(match) => match[1] ?? "",
	);

	it("finds the routers of the app", () => {
		expect(keys.length).toBeGreaterThan(50);
	});

	it("classifies every router", () => {
		const missing = keys.filter((key) => !(key in ROUTER_POLICY));
		expect(missing).toEqual([]);
	});

	it("keeps server-wide routers away from clients", () => {
		for (const key of [
			"admin",
			"cluster",
			"swarm",
			"dockerImage",
			"dockerVolume",
			"serverSecurity",
			"sandbox",
			"transfer",
		]) {
			expect(ROUTER_POLICY[key]).toBe("operator");
		}
	});
});
