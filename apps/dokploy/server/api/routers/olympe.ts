import { db } from "@dokploy/server/db";
import { olympePlan } from "@dokploy/server/db/schema";
import {
	BILLING_DURATIONS,
	completePayment,
	findPayment,
	formatAmount,
	formatDate,
	getPaymentProvider,
	listPayments,
	listTenantsForOperator,
	offerMonths,
	operatorReactivate,
	operatorSuspend,
	organizationName,
	PAYMENT_METHOD_LABELS,
	PAYMENT_METHODS,
	priceFor,
	revenueSummary,
	runBillingCycle,
	setTenantPlan,
	startCheckout,
} from "@dokploy/server/services/olympe/billing";
import { getOlympeConfig } from "@dokploy/server/services/olympe/config";
import { measureDiskUsage } from "@dokploy/server/services/olympe/jobs";
import { isolateExistingServices } from "@dokploy/server/services/olympe/network";
import { getOrganizationUsage } from "@dokploy/server/services/olympe/quotas";
import { hasSelfSignedUp } from "@dokploy/server/services/olympe/signup";
import {
	composesOf,
	swarmServicesOf,
} from "@dokploy/server/services/olympe/suspension";
import {
	isClientOrganization,
	isOperatorOrganization,
} from "@dokploy/server/services/olympe/tenancy";
import { getTenant, listPlans } from "@dokploy/server/services/olympe/tenants";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
	adminProcedure,
	createTRPCRouter,
	operatorProcedure,
	protectedProcedure,
	publicProcedure,
} from "../trpc";

const escapeHtml = (value: string) =>
	value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const assertOwnPayment = async (paymentId: string, organizationId: string) => {
	const payment = await findPayment(paymentId);
	if (payment.organizationId !== organizationId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Paiement introuvable" });
	}
	return payment;
};

const planInput = z.object({
	planId: z.string().optional(),
	slug: z
		.string()
		.min(2)
		.max(40)
		.regex(/^[a-z0-9-]+$/),
	name: z.string().min(1).max(60),
	description: z.string().max(200).default(""),
	priceMonthly: z.number().int().min(0),
	currency: z.string().min(3).max(3).default("XAF"),
	cpu: z.number().positive().max(64),
	memoryMb: z.number().int().min(128),
	diskGb: z.number().int().min(1),
	maxServices: z.number().int().min(0),
	maxDatabases: z.number().int().min(0),
	maxDomains: z.number().int().min(0),
	maxConcurrentBuilds: z.number().int().min(1),
	maxMembers: z.number().int().min(1),
	aiDiagnosesPerMonth: z.number().int().min(0),
	isTrial: z.boolean().default(false),
	trialDays: z.number().int().min(0).default(0),
	isPublic: z.boolean().default(true),
	active: z.boolean().default(true),
	sortOrder: z.number().int().default(0),
});

export const olympeRouter = createTRPCRouter({
	publicInfo: publicProcedure.query(async () => {
		const config = getOlympeConfig();
		return {
			multiTenant: config.multiTenant,
			publicSignup: config.publicSignup,
			turnstileSiteKey: config.turnstileSiteKey,
			termsUrl: config.termsUrl,
			privacyUrl: config.privacyUrl,
			abuseEmail: config.abuseEmail,
			tenantAppsDomain: config.tenantAppsDomain,
			annualFreeMonths: config.annualFreeMonths,
			plans: config.multiTenant ? await listPlans() : [],
		};
	}),

	me: protectedProcedure.query(async ({ ctx }) => {
		const config = getOlympeConfig();
		const organizationId = ctx.session.activeOrganizationId;
		const isClient = isClientOrganization(organizationId);
		if (!isClient) {
			return {
				multiTenant: config.multiTenant,
				isOperator: isOperatorOrganization(organizationId),
				tenant: null,
				usage: null,
			};
		}
		const tenant = await getTenant(organizationId);
		const { email, emailVerified } = ctx.user as {
			email: string;
			emailVerified?: boolean;
		};
		return {
			multiTenant: true,
			isOperator: false,
			email,
			mustVerifyEmail:
				config.emailVerificationRequired &&
				emailVerified === false &&
				(await hasSelfSignedUp(email)),
			tenant: {
				status: tenant.status,
				plan: tenant.plan,
				currentPeriodEnd: tenant.currentPeriodEnd,
				suspendedAt: tenant.suspendedAt,
				graceDays: config.graceDays,
			},
			usage: await getOrganizationUsage(organizationId),
		};
	}),

	billingOptions: protectedProcedure.query(async () => {
		const config = getOlympeConfig();
		const plans = (await listPlans()).filter((plan) => !plan.isTrial);
		return {
			provider: config.paymentProvider,
			simulated: config.paymentProvider === "simulated",
			durations: BILLING_DURATIONS,
			methods: PAYMENT_METHODS.map((id) => ({
				id,
				label: PAYMENT_METHOD_LABELS[id],
			})),
			annualFreeMonths: config.annualFreeMonths,
			plans: plans.map((plan) => ({
				...plan,
				prices: Object.fromEntries(
					BILLING_DURATIONS.map((months) => [
						months,
						priceFor(plan, months, config.annualFreeMonths),
					]),
				),
			})),
		};
	}),

	checkout: adminProcedure
		.input(
			z.object({
				planId: z.string().min(1),
				months: z.number().int(),
				method: z.enum(PAYMENT_METHODS),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (!isClientOrganization(ctx.session.activeOrganizationId)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "L'organisation de l'opérateur ne paie pas de forfait.",
				});
			}
			return startCheckout({
				organizationId: ctx.session.activeOrganizationId,
				...input,
			});
		}),

	payment: protectedProcedure
		.input(z.object({ paymentId: z.string().min(1) }))
		.query(async ({ ctx, input }) =>
			assertOwnPayment(input.paymentId, ctx.session.activeOrganizationId),
		),

	simulatePayment: adminProcedure
		.input(
			z.object({
				paymentId: z.string().min(1),
				outcome: z.enum(["succeeded", "failed", "canceled"]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (getPaymentProvider().id !== "simulated") {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Le paiement simulé est désactivé.",
				});
			}
			await assertOwnPayment(input.paymentId, ctx.session.activeOrganizationId);
			return completePayment(input.paymentId, input.outcome);
		}),

	payments: protectedProcedure.query(({ ctx }) =>
		listPayments(ctx.session.activeOrganizationId),
	),

	invoice: protectedProcedure
		.input(z.object({ paymentId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const payment = await assertOwnPayment(
				input.paymentId,
				ctx.session.activeOrganizationId,
			);
			if (
				payment.status !== "succeeded" ||
				!payment.invoiceNumber ||
				!payment.paidAt
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Pas de facture pour ce paiement",
				});
			}
			const issuer = process.env.OLYMPE_INVOICE_ISSUER || "KTC";
			const issuerAddress = process.env.OLYMPE_INVOICE_ADDRESS || "";
			const customer = await organizationName(payment.organizationId);
			const simulated = payment.provider === "simulated";
			return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Facture ${escapeHtml(payment.invoiceNumber)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;color:#111}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}.total{font-weight:600}.muted{color:#666}.warn{border:1px solid #c00;color:#c00;padding:8px;margin-top:16px}</style></head><body>
<h1>Facture ${escapeHtml(payment.invoiceNumber)}</h1>
<p><b>${escapeHtml(issuer)}</b> — Olympe<br><span class="muted">${escapeHtml(issuerAddress)}</span></p>
<p>Client : <b>${escapeHtml(customer)}</b><br>Date : ${escapeHtml(formatDate(payment.paidAt))}</p>
<table><tr><th>Désignation</th><th>Durée</th><th>Montant</th></tr>
<tr><td>Forfait ${escapeHtml(payment.plan.name)}</td><td>${payment.months} mois</td><td>${escapeHtml(formatAmount(payment.amount, payment.currency))}</td></tr>
<tr class="total"><td colspan="2">Total payé</td><td>${escapeHtml(formatAmount(payment.amount, payment.currency))}</td></tr></table>
<p class="muted">Moyen de paiement : ${escapeHtml(PAYMENT_METHOD_LABELS[payment.method as keyof typeof PAYMENT_METHOD_LABELS] ?? payment.method)} · Référence ${escapeHtml(payment.providerReference)}</p>
${simulated ? '<p class="warn">Paiement simulé : document de test sans valeur comptable.</p>' : ""}
</body></html>`;
		}),

	operator: createTRPCRouter({
		tenants: operatorProcedure.query(() => listTenantsForOperator()),
		revenue: operatorProcedure.query(() => revenueSummary()),
		plans: operatorProcedure.query(() => listPlans({ includeHidden: true })),
		savePlan: operatorProcedure.input(planInput).mutation(async ({ input }) => {
			const { planId, ...values } = input;
			if (planId) {
				await db
					.update(olympePlan)
					.set(values)
					.where(eq(olympePlan.planId, planId));
				return planId;
			}
			const [created] = await db.insert(olympePlan).values(values).returning();
			return created?.planId;
		}),
		setPlan: operatorProcedure
			.input(z.object({ organizationId: z.string(), planId: z.string() }))
			.mutation(({ input }) =>
				setTenantPlan(input.organizationId, input.planId),
			),
		offerMonths: operatorProcedure
			.input(
				z.object({
					organizationId: z.string(),
					months: z.number().int().min(1).max(24),
				}),
			)
			.mutation(({ input }) => offerMonths(input.organizationId, input.months)),
		suspend: operatorProcedure
			.input(z.object({ organizationId: z.string() }))
			.mutation(({ input }) => operatorSuspend(input.organizationId)),
		reactivate: operatorProcedure
			.input(z.object({ organizationId: z.string() }))
			.mutation(({ input }) => operatorReactivate(input.organizationId)),
		runBillingCycle: operatorProcedure.mutation(() => runBillingCycle()),
		isolateExisting: operatorProcedure.mutation(async () => {
			const report = [];
			for (const tenant of await listTenantsForOperator()) {
				const result = await isolateExistingServices(
					await swarmServicesOf(tenant.organizationId),
					tenant.organizationId,
				);
				const composes = await composesOf(tenant.organizationId);
				report.push({
					name: tenant.name,
					...result,
					composesToRedeploy: composes.map((item) => item.appName),
				});
			}
			return report;
		}),
		measureDisk: operatorProcedure.mutation(() => measureDiskUsage()),
	}),
});
