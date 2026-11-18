import type { OlympePlan } from "@dokploy/server/db/schema";
import {
	applyComposeLimits,
	parseComposeCpus,
	parseComposeMemoryMb,
} from "@dokploy/server/services/olympe/enforce";
import {
	ownerAppName,
	parseDockerSize,
} from "@dokploy/server/services/olympe/jobs";
import {
	checkBudget,
	checkCreationLimit,
	cpuFromNano,
	effectiveServiceLimits,
	memoryMbFromBytes,
} from "@dokploy/server/services/olympe/quotas";
import type { TenantWithPlan } from "@dokploy/server/services/olympe/tenants";
import { describe, expect, it } from "vitest";

const starter = {
	planId: "starter",
	name: "Starter",
	cpu: 1,
	memoryMb: 2048,
	diskGb: 15,
	maxServices: 6,
	maxDatabases: 2,
	maxDomains: 5,
	maxMembers: 2,
} as OlympePlan;

describe("service limits", () => {
	it("reads Docker units", () => {
		expect(cpuFromNano("500000000")).toBe(0.5);
		expect(cpuFromNano("")).toBeNull();
		expect(memoryMbFromBytes(String(256 * 1024 * 1024))).toBe(256);
	});

	it("applies the default and never exceeds the plan", () => {
		expect(effectiveServiceLimits({}, starter)).toEqual({
			cpu: 0.5,
			memoryMb: 512,
		});
		expect(
			effectiveServiceLimits(
				{ cpuLimit: String(4e9), memoryLimit: String(8 * 1024 ** 3) },
				starter,
			),
		).toEqual({ cpu: 1, memoryMb: 2048 });
	});

	it("explains what is left when the budget is exceeded", () => {
		expect(
			checkBudget(
				starter,
				{ cpu: 0.5, memoryMb: 1536 },
				{ cpu: 0.5, memoryMb: 512 },
			),
		).toBeNull();
		expect(
			checkBudget(
				starter,
				{ cpu: 0.5, memoryMb: 1800 },
				{ cpu: 0.25, memoryMb: 512 },
			),
		).toContain("il vous reste 248 Mo");
		expect(
			checkBudget(
				starter,
				{ cpu: 0.9, memoryMb: 0 },
				{ cpu: 0.5, memoryMb: 128 },
			),
		).toContain("vCPU");
	});

	it("blocks creation at the plan limit", () => {
		const usage = {
			cpu: 0,
			memoryMb: 0,
			diskBytes: 0,
			diskMeasuredAt: null,
			services: 6,
			databases: 1,
			domains: 0,
			members: 2,
		};
		expect(checkCreationLimit(starter, usage, "service")).toContain(
			"6 services",
		);
		expect(checkCreationLimit(starter, usage, "database")).toBeNull();
		expect(checkCreationLimit(starter, usage, "member")).toContain("2 membres");
	});
});

describe("compose limits", () => {
	it("parses compose units", () => {
		expect(parseComposeMemoryMb("512M")).toBe(512);
		expect(parseComposeMemoryMb("1g")).toBe(1024);
		expect(parseComposeMemoryMb("1.5GB")).toBe(1536);
		expect(parseComposeMemoryMb(268435456)).toBe(256);
		expect(parseComposeMemoryMb("lots")).toBeNull();
		expect(parseComposeCpus("0.5")).toBe(0.5);
	});

	it("writes limits into every service and sums replicas", () => {
		const spec: any = {
			services: {
				web: { image: "a", deploy: { replicas: 2 } },
				worker: { image: "b", mem_limit: "256m", cpus: 0.25 },
				big: {
					image: "c",
					deploy: { resources: { limits: { memory: "8G", cpus: "8" } } },
				},
			},
		};
		const total = applyComposeLimits(spec, { plan: starter } as TenantWithPlan);
		expect(spec.services.web.deploy.resources.limits).toEqual({
			cpus: "0.5",
			memory: "512M",
		});
		expect(spec.services.worker.mem_limit).toBeUndefined();
		expect(spec.services.worker.deploy.resources.limits).toEqual({
			cpus: "0.25",
			memory: "256M",
		});
		expect(spec.services.big.deploy.resources.limits).toEqual({
			cpus: "1",
			memory: "2048M",
		});
		expect(total).toEqual({ cpu: 2.25, memoryMb: 512 * 2 + 256 + 2048 });
	});
});

describe("disk measurement", () => {
	it("parses docker sizes", () => {
		expect(parseDockerSize("1.5GB")).toBe(1.5e9);
		expect(parseDockerSize("0B")).toBe(0);
		expect(parseDockerSize("512kB")).toBe(512000);
	});

	it("attributes a volume to the longest matching app name", () => {
		const names = ["shop-ab12", "shop-ab12-db"];
		expect(ownerAppName("shop-ab12-db-data", names)).toBe("shop-ab12-db");
		expect(ownerAppName("shop-ab12_uploads", names)).toBe("shop-ab12");
		expect(ownerAppName("shop-ab123-data", names)).toBeNull();
	});
});
