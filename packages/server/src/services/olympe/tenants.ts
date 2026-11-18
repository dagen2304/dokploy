import { db } from "@dokploy/server/db";
import {
	type OlympePlan,
	type OlympeTenant,
	olympePlan,
	olympeTenant,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";
import { getOlympeConfig } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

export const addDays = (date: Date, days: number) =>
	new Date(date.getTime() + days * DAY_MS);

export const addMonths = (date: Date, months: number) => {
	const next = new Date(date.getTime());
	const day = next.getUTCDate();
	next.setUTCDate(1);
	next.setUTCMonth(next.getUTCMonth() + months);
	const lastDay = new Date(
		Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
	).getUTCDate();
	next.setUTCDate(Math.min(day, lastDay));
	return next;
};

export const listPlans = async (options: { includeHidden?: boolean } = {}) => {
	const plans = await db.query.olympePlan.findMany({
		orderBy: [asc(olympePlan.sortOrder), asc(olympePlan.priceMonthly)],
	});
	return options.includeHidden
		? plans
		: plans.filter((plan) => plan.active && plan.isPublic);
};

export const findPlanById = async (planId: string) => {
	const plan = await db.query.olympePlan.findFirst({
		where: eq(olympePlan.planId, planId),
	});
	if (!plan) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Forfait introuvable" });
	}
	return plan;
};

const findDefaultPlan = async () => {
	const { defaultPlanSlug } = getOlympeConfig();
	const plan =
		(await db.query.olympePlan.findFirst({
			where: eq(olympePlan.slug, defaultPlanSlug),
		})) ??
		(await db.query.olympePlan.findFirst({
			orderBy: [asc(olympePlan.sortOrder)],
		}));
	if (!plan) {
		throw new Error(
			"Aucun forfait Olympe en base : la migration de démarrage n'a pas été exécutée",
		);
	}
	return plan;
};

export const initialPeriodEnd = (plan: OlympePlan, now = new Date()) =>
	plan.isTrial ? addDays(now, plan.trialDays) : addMonths(now, 1);

export type TenantWithPlan = OlympeTenant & { plan: OlympePlan };

// Creates the tenant row on first use, so organizations that existed before
// multi-tenant mode was switched on start on the default plan.
export const getTenant = async (
	organizationId: string,
): Promise<TenantWithPlan> => {
	const existing = await db.query.olympeTenant.findFirst({
		where: eq(olympeTenant.organizationId, organizationId),
		with: { plan: true },
	});
	if (existing) return existing;

	const plan = await findDefaultPlan();
	const now = new Date();
	await db
		.insert(olympeTenant)
		.values({
			organizationId,
			planId: plan.planId,
			status: plan.isTrial ? "trial" : "active",
			currentPeriodEnd: initialPeriodEnd(plan, now),
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing();

	const created = await db.query.olympeTenant.findFirst({
		where: eq(olympeTenant.organizationId, organizationId),
		with: { plan: true },
	});
	if (!created) throw new Error("Impossible de créer l'espace client");
	return created;
};

export const updateTenant = async (
	organizationId: string,
	values: Partial<Omit<OlympeTenant, "organizationId" | "createdAt">>,
) => {
	await db
		.update(olympeTenant)
		.set({ ...values, updatedAt: new Date() })
		.where(eq(olympeTenant.organizationId, organizationId));
};

export const assertTenantNotSuspended = (tenant: TenantWithPlan) => {
	if (tenant.status === "suspended") {
		throw new TRPCError({
			code: "FORBIDDEN",
			message:
				"Votre espace est suspendu faute de paiement. Renouvelez votre forfait dans Facturation pour le réactiver.",
		});
	}
};
