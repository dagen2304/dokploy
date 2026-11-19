import type { OlympePlan } from "@dokploy/server/db/schema";
import {
	computeNewPeriodEnd,
	decideCycleAction,
	priceFor,
	usageExceedsPlan,
} from "@dokploy/server/services/olympe/billing";
import { addMonths } from "@dokploy/server/services/olympe/tenants";
import { describe, expect, it } from "vitest";

const plan = (overrides: Partial<OlympePlan>): OlympePlan => ({
	planId: "p",
	slug: "p",
	name: "P",
	description: "",
	priceMonthly: 5000,
	currency: "XAF",
	cpu: 1,
	memoryMb: 2048,
	diskGb: 15,
	maxServices: 6,
	maxDatabases: 2,
	maxDomains: 5,
	maxConcurrentBuilds: 1,
	maxMembers: 2,
	aiDiagnosesPerMonth: 30,
	isTrial: false,
	trialDays: 0,
	isPublic: true,
	active: true,
	sortOrder: 0,
	createdAt: new Date(),
	...overrides,
});

const DAY = 86_400_000;

describe("priceFor", () => {
	it("bills every month, except the free months of a yearly payment", () => {
		const starter = plan({ priceMonthly: 5000 });
		expect(priceFor(starter, 1, 2)).toBe(5000);
		expect(priceFor(starter, 3, 2)).toBe(15000);
		expect(priceFor(starter, 12, 2)).toBe(50000);
		expect(priceFor(starter, 12, 0)).toBe(60000);
	});
});

describe("computeNewPeriodEnd", () => {
	const now = new Date("2026-11-18T12:00:00Z");
	const starter = plan({ planId: "starter", priceMonthly: 5000 });
	const pro = plan({ planId: "pro", priceMonthly: 12500 });
	const trial = plan({ planId: "essai", priceMonthly: 0, isTrial: true });

	it("adds the paid months after the remaining days of the same plan", () => {
		const end = computeNewPeriodEnd({
			now,
			currentEnd: new Date(now.getTime() + 10 * DAY),
			currentPlan: starter,
			newPlan: starter,
			months: 1,
			status: "active",
		});
		expect(end.getTime()).toBe(addMonths(now, 1).getTime() + 10 * DAY);
	});

	it("converts remaining days at the price ratio when upgrading", () => {
		const end = computeNewPeriodEnd({
			now,
			currentEnd: new Date(now.getTime() + 10 * DAY),
			currentPlan: starter,
			newPlan: pro,
			months: 1,
			status: "active",
		});
		expect(end.getTime()).toBe(addMonths(now, 1).getTime() + 4 * DAY);
	});

	it("gives no credit for a trial or a suspended space", () => {
		for (const [currentPlan, status] of [
			[trial, "trial"],
			[starter, "suspended"],
		] as const) {
			const end = computeNewPeriodEnd({
				now,
				currentEnd: new Date(now.getTime() + 5 * DAY),
				currentPlan,
				newPlan: starter,
				months: 3,
				status,
			});
			expect(end.getTime()).toBe(addMonths(now, 3).getTime());
		}
	});

	it("keeps the end-of-month day when adding months", () => {
		expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
			"2026-02-28T00:00:00.000Z",
		);
	});
});

describe("decideCycleAction", () => {
	const config = {
		reminderDays: [7, 3, 1],
		graceDays: 3,
		deleteAfterDays: 30,
		deletionWarningDays: 7,
	};
	const end = new Date("2026-12-01T00:00:00Z");
	const at = (days: number) => new Date(end.getTime() + days * DAY);
	const tenant = (
		status: "trial" | "active" | "past_due" | "suspended",
		lastReminderKey: string | null = null,
		suspendedAt: Date | null = null,
	) => ({
		status,
		currentPeriodEnd: end,
		lastReminderKey,
		suspendedAt,
	});

	it("waits while the end is far", () => {
		expect(decideCycleAction(tenant("active"), at(-10), config)).toEqual({
			type: "none",
		});
	});

	it("reminds once per threshold", () => {
		const action = decideCycleAction(tenant("active"), at(-6.5), config);
		expect(action).toMatchObject({ type: "remind", days: 7 });
		const key = action.type === "remind" ? action.key : "";
		expect(decideCycleAction(tenant("active", key), at(-6), config)).toEqual({
			type: "none",
		});
		expect(
			decideCycleAction(tenant("active", key), at(-2.5), config),
		).toMatchObject({ type: "remind", days: 3 });
	});

	it("marks the space past due, then suspends it after the grace period", () => {
		expect(decideCycleAction(tenant("trial"), at(0.1), config)).toEqual({
			type: "past_due",
		});
		expect(decideCycleAction(tenant("past_due"), at(2), config)).toEqual({
			type: "none",
		});
		expect(decideCycleAction(tenant("past_due"), at(3), config)).toEqual({
			type: "suspend",
		});
		expect(decideCycleAction(tenant("suspended"), at(40), config)).toEqual({
			type: "none",
		});
	});

	it("warns once, 7 days before a suspended space can be deleted", () => {
		const suspendedAt = at(3);
		expect(
			decideCycleAction(tenant("suspended", null, suspendedAt), at(25), config),
		).toEqual({ type: "none" });
		const action = decideCycleAction(
			tenant("suspended", null, suspendedAt),
			at(26.5),
			config,
		);
		expect(action).toMatchObject({ type: "warn_deletion" });
		if (action.type !== "warn_deletion") return;
		expect(action.deletableAt.toISOString()).toBe(at(33).toISOString());
		expect(
			decideCycleAction(
				tenant("suspended", action.key, suspendedAt),
				at(28),
				config,
			),
		).toEqual({ type: "none" });
	});
});

describe("usageExceedsPlan", () => {
	it("names what does not fit in a smaller plan", () => {
		const usage = {
			cpu: 1.5,
			memoryMb: 3000,
			diskBytes: 0,
			diskMeasuredAt: null,
			services: 3,
			databases: 3,
			domains: 1,
			members: 1,
		};
		expect(usageExceedsPlan(usage, plan({}))).toEqual([
			"la mémoire utilisée",
			"le processeur utilisé",
			"le nombre de bases de données",
		]);
	});
});
