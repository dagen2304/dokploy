import { db } from "@dokploy/server/db";
import {
	member,
	type OlympePayment,
	type OlympePlan,
	olympePayment,
	organization,
	user,
} from "@dokploy/server/db/schema";
import { sendEmail } from "@dokploy/server/verification/send-verification-email";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getOlympeConfig } from "./config";
import { getOrganizationUsage, type OrganizationUsage } from "./quotas";
import { resumeOrganization, suspendOrganization } from "./suspension";
import {
	addDays,
	addMonths,
	findPlanById,
	getTenant,
	type TenantWithPlan,
	updateTenant,
} from "./tenants";

export const BILLING_DURATIONS = [1, 3, 6, 12] as const;
export const PAYMENT_METHODS = ["mtn_momo", "orange_money", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
	mtn_momo: "MTN Mobile Money",
	orange_money: "Orange Money",
	card: "Carte bancaire",
};

export type CheckoutSession = {
	providerReference: string;
	redirectUrl: string;
};

// Every real aggregator (CinetPay, FedaPay, Flutterwave, Paystack…) plugs in
// here: open a checkout, then confirm through a signed webhook that ends in
// completePayment().
export interface PaymentProvider {
	id: string;
	createCheckout(payment: OlympePayment): Promise<CheckoutSession>;
}

const simulatedProvider: PaymentProvider = {
	id: "simulated",
	async createCheckout(payment) {
		return {
			providerReference: `sim_${nanoid(16)}`,
			redirectUrl: `/dashboard/billing/simulate?payment=${payment.paymentId}`,
		};
	},
};

const PROVIDERS: Record<string, PaymentProvider> = {
	[simulatedProvider.id]: simulatedProvider,
};

export const getPaymentProvider = () => {
	const { paymentProvider } = getOlympeConfig();
	const provider = PROVIDERS[paymentProvider];
	if (!provider) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message: `Le moyen de paiement « ${paymentProvider} » n'est pas encore branché.`,
		});
	}
	return provider;
};

export const priceFor = (
	plan: OlympePlan,
	months: number,
	annualFreeMonths: number,
) => {
	const billedMonths =
		months >= 12 ? Math.max(1, months - annualFreeMonths) : months;
	return plan.priceMonthly * billedMonths;
};

export const usageExceedsPlan = (
	usage: OrganizationUsage,
	plan: OlympePlan,
): string[] => {
	const problems: string[] = [];
	if (usage.memoryMb > plan.memoryMb) problems.push("la mémoire utilisée");
	if (usage.cpu > plan.cpu + 0.001) problems.push("le processeur utilisé");
	if (usage.services > plan.maxServices) problems.push("le nombre de services");
	if (usage.databases > plan.maxDatabases)
		problems.push("le nombre de bases de données");
	if (usage.domains > plan.maxDomains) problems.push("le nombre de domaines");
	if (usage.members > plan.maxMembers) problems.push("le nombre de membres");
	if (usage.diskBytes > plan.diskGb * 1024 ** 3)
		problems.push("l'espace disque");
	return problems;
};

// Days left on the current plan are converted at the price ratio of the new
// plan, so switching plan mid-period never loses what was already paid.
export const computeNewPeriodEnd = ({
	now,
	currentEnd,
	currentPlan,
	newPlan,
	months,
	status,
}: {
	now: Date;
	currentEnd: Date;
	currentPlan: OlympePlan;
	newPlan: OlympePlan;
	months: number;
	status: TenantWithPlan["status"];
}) => {
	const remainingMs =
		status === "suspended" || currentPlan.isTrial
			? 0
			: Math.max(0, currentEnd.getTime() - now.getTime());
	const sameValue =
		currentPlan.planId === newPlan.planId || currentPlan.priceMonthly === 0;
	const creditMs =
		sameValue || newPlan.priceMonthly === 0
			? remainingMs
			: remainingMs * (currentPlan.priceMonthly / newPlan.priceMonthly);
	return new Date(addMonths(now, months).getTime() + creditMs);
};

export const startCheckout = async ({
	organizationId,
	planId,
	months,
	method,
}: {
	organizationId: string;
	planId: string;
	months: number;
	method: PaymentMethod;
}) => {
	if (
		!BILLING_DURATIONS.includes(months as (typeof BILLING_DURATIONS)[number])
	) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "Durée non proposée" });
	}
	const plan = await findPlanById(planId);
	if (!plan.active || plan.isTrial || plan.priceMonthly <= 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Ce forfait ne peut pas être acheté",
		});
	}
	const usage = await getOrganizationUsage(organizationId);
	const tooBig = usageExceedsPlan(usage, plan);
	if (tooBig.length > 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Votre utilisation actuelle dépasse le forfait ${plan.name} (${tooBig.join(", ")}). Supprimez des ressources ou choisissez un forfait plus grand.`,
		});
	}

	const provider = getPaymentProvider();
	const config = getOlympeConfig();
	const [payment] = await db
		.insert(olympePayment)
		.values({
			organizationId,
			planId,
			months,
			amount: priceFor(plan, months, config.annualFreeMonths),
			currency: plan.currency,
			method,
			provider: provider.id,
			providerReference: `pending_${nanoid(16)}`,
			status: "pending",
		})
		.returning();
	if (!payment) throw new Error("Paiement non créé");

	const session = await provider.createCheckout(payment);
	await db
		.update(olympePayment)
		.set({ providerReference: session.providerReference })
		.where(eq(olympePayment.paymentId, payment.paymentId));

	return { paymentId: payment.paymentId, redirectUrl: session.redirectUrl };
};

const nextInvoiceNumber = async (now: Date) => {
	const [row] = await db
		.select({ value: count() })
		.from(olympePayment)
		.where(isNotNull(olympePayment.invoiceNumber));
	const sequence = Number(row?.value ?? 0) + 1;
	return `OLY-${now.getUTCFullYear()}-${String(sequence).padStart(5, "0")}`;
};

export const findPayment = async (paymentId: string) => {
	const payment = await db.query.olympePayment.findFirst({
		where: eq(olympePayment.paymentId, paymentId),
		with: { plan: true },
	});
	if (!payment) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Paiement introuvable" });
	}
	return payment;
};

// Idempotent: a provider may deliver the same webhook several times.
export const completePayment = async (
	paymentId: string,
	outcome: "succeeded" | "failed" | "canceled",
) => {
	const payment = await findPayment(paymentId);
	if (payment.status !== "pending") return payment;

	const now = new Date();
	if (outcome !== "succeeded") {
		await db
			.update(olympePayment)
			.set({ status: outcome })
			.where(eq(olympePayment.paymentId, paymentId));
		return { ...payment, status: outcome };
	}

	const tenant = await getTenant(payment.organizationId);
	const wasSuspended = tenant.status === "suspended";
	const currentPeriodEnd = computeNewPeriodEnd({
		now,
		currentEnd: tenant.currentPeriodEnd,
		currentPlan: tenant.plan,
		newPlan: payment.plan,
		months: payment.months,
		status: tenant.status,
	});

	const invoiceNumber = await nextInvoiceNumber(now);
	await db
		.update(olympePayment)
		.set({ status: "succeeded", paidAt: now, invoiceNumber })
		.where(
			and(
				eq(olympePayment.paymentId, paymentId),
				eq(olympePayment.status, "pending"),
			),
		);

	if (wasSuspended) await resumeOrganization(payment.organizationId);
	await updateTenant(payment.organizationId, {
		planId: payment.planId,
		status: "active",
		currentPeriodEnd,
		lastReminderKey: null,
	});

	await notifyOwners(
		payment.organizationId,
		`Paiement reçu — facture ${invoiceNumber}`,
		`<p>Merci ! Nous avons bien reçu votre paiement de <b>${formatAmount(payment.amount, payment.currency)}</b> pour le forfait <b>${payment.plan.name}</b> (${payment.months} mois).</p>
<p>Votre espace est actif jusqu'au <b>${formatDate(currentPeriodEnd)}</b>.</p>
<p>Facture : ${invoiceNumber}</p>`,
	);

	return {
		...payment,
		status: "succeeded" as const,
		invoiceNumber,
		paidAt: now,
	};
};

export const listPayments = (organizationId: string) =>
	db.query.olympePayment.findMany({
		where: eq(olympePayment.organizationId, organizationId),
		with: { plan: true },
		orderBy: [desc(olympePayment.createdAt)],
		limit: 50,
	});

export const formatAmount = (amount: number, currency: string) =>
	`${new Intl.NumberFormat("fr-FR").format(amount)} ${currency === "XAF" ? "FCFA" : currency}`;

export const formatDate = (date: Date) =>
	new Intl.DateTimeFormat("fr-FR", {
		dateStyle: "long",
		timeZone: "Africa/Douala",
	}).format(date);

const ownerEmails = async (organizationId: string) => {
	const rows = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(
			and(eq(member.organizationId, organizationId), eq(member.role, "owner")),
		);
	return rows.map((row) => row.email);
};

export const notifyOwners = async (
	organizationId: string,
	subject: string,
	html: string,
) => {
	if (!process.env.SMTP_SERVER) return;
	for (const email of await ownerEmails(organizationId)) {
		try {
			await sendEmail({ email, subject: `Olympe — ${subject}`, text: html });
		} catch (error) {
			console.error(`[olympe] email to ${email} failed`, error);
		}
	}
};

const DAY_MS = 24 * 60 * 60 * 1000;

export type CycleAction =
	| { type: "remind"; days: number; key: string }
	| { type: "past_due" }
	| { type: "suspend" }
	| { type: "warn_deletion"; key: string; deletableAt: Date }
	| { type: "none" };

// Pure decision for one tenant at `now`; runBillingCycle applies it.
export const decideCycleAction = (
	tenant: Pick<
		TenantWithPlan,
		"status" | "currentPeriodEnd" | "lastReminderKey" | "suspendedAt"
	>,
	now: Date,
	config: {
		reminderDays: number[];
		graceDays: number;
		deleteAfterDays: number;
		deletionWarningDays: number;
	},
): CycleAction => {
	if (tenant.status === "suspended") {
		if (!tenant.suspendedAt) return { type: "none" };
		const deletableAt = addDays(tenant.suspendedAt, config.deleteAfterDays);
		const warnFrom = addDays(deletableAt, -config.deletionWarningDays);
		const key = `delete:${tenant.suspendedAt.toISOString()}`;
		return now.getTime() >= warnFrom.getTime() && tenant.lastReminderKey !== key
			? { type: "warn_deletion", key, deletableAt }
			: { type: "none" };
	}
	const end = tenant.currentPeriodEnd.getTime();
	if (
		now.getTime() >=
		addDays(tenant.currentPeriodEnd, config.graceDays).getTime()
	) {
		return { type: "suspend" };
	}
	if (now.getTime() >= end) {
		return tenant.status === "past_due"
			? { type: "none" }
			: { type: "past_due" };
	}
	const daysLeft = Math.ceil((end - now.getTime()) / DAY_MS);
	const due = config.reminderDays.filter((day) => daysLeft <= day);
	if (due.length === 0) return { type: "none" };
	const day = Math.min(...due);
	const key = `${tenant.currentPeriodEnd.toISOString()}:${day}`;
	return tenant.lastReminderKey === key
		? { type: "none" }
		: { type: "remind", days: day, key };
};

export const runBillingCycle = async (now = new Date()) => {
	const config = getOlympeConfig();
	if (!config.multiTenant) return;

	const tenants = await db.query.olympeTenant.findMany({
		with: { plan: true },
	});
	for (const tenant of tenants) {
		if (tenant.organizationId === config.operatorOrgId) continue;
		const action = decideCycleAction(tenant, now, config);
		try {
			if (action.type === "remind") {
				await updateTenant(tenant.organizationId, {
					lastReminderKey: action.key,
				});
				await notifyOwners(
					tenant.organizationId,
					`votre forfait se termine dans ${action.days} jour${action.days > 1 ? "s" : ""}`,
					`<p>Votre forfait <b>${tenant.plan.name}</b> se termine le <b>${formatDate(tenant.currentPeriodEnd)}</b>.</p>
<p>Renouvelez-le depuis la page Facturation de votre espace pour que vos applications restent en ligne.</p>`,
				);
			} else if (action.type === "past_due") {
				await updateTenant(tenant.organizationId, { status: "past_due" });
				await notifyOwners(
					tenant.organizationId,
					"échéance dépassée",
					`<p>Votre forfait <b>${tenant.plan.name}</b> est arrivé à échéance le ${formatDate(tenant.currentPeriodEnd)}.</p>
<p>Vos applications restent en ligne encore <b>${config.graceDays} jours</b>. Sans paiement, elles seront ensuite mises en pause ; vos données seront conservées.</p>`,
				);
			} else if (action.type === "warn_deletion") {
				await updateTenant(tenant.organizationId, {
					lastReminderKey: action.key,
				});
				await notifyOwners(
					tenant.organizationId,
					"suppression prochaine de votre espace",
					`<p>Votre espace est suspendu depuis le ${formatDate(tenant.suspendedAt ?? now)} faute de paiement.</p>
<p>Sans renouvellement, il pourra être <b>supprimé définitivement à partir du ${formatDate(action.deletableAt)}</b>, avec toutes ses applications, bases de données et volumes.</p>
<p>Pour l'éviter, renouvelez votre forfait depuis la page Facturation, ou récupérez vos données avant cette date.</p>`,
				);
			} else if (action.type === "suspend") {
				await suspendOrganization(tenant.organizationId);
				await notifyOwners(
					tenant.organizationId,
					"espace suspendu",
					`<p>Votre espace a été suspendu faute de paiement : vos applications sont en pause, vos données sont conservées.</p>
<p>Renouvelez votre forfait depuis la page Facturation : tout redémarre automatiquement.</p>`,
				);
			}
		} catch (error) {
			console.error(
				`[olympe] billing cycle for ${tenant.organizationId}`,
				error,
			);
		}
	}
};

// Operator actions.
export const offerMonths = async (organizationId: string, months: number) => {
	const tenant = await getTenant(organizationId);
	const base =
		tenant.currentPeriodEnd.getTime() > Date.now() &&
		tenant.status !== "suspended"
			? tenant.currentPeriodEnd
			: new Date();
	if (tenant.status === "suspended") await resumeOrganization(organizationId);
	await updateTenant(organizationId, {
		status: "active",
		currentPeriodEnd: addMonths(base, months),
		lastReminderKey: null,
	});
};

export const setTenantPlan = async (organizationId: string, planId: string) => {
	await findPlanById(planId);
	await getTenant(organizationId);
	await updateTenant(organizationId, { planId });
};

export const operatorSuspend = suspendOrganization;

export const operatorReactivate = async (organizationId: string) => {
	const tenant = await getTenant(organizationId);
	if (tenant.status === "suspended") await resumeOrganization(organizationId);
	await updateTenant(organizationId, {
		status:
			tenant.currentPeriodEnd.getTime() > Date.now() ? "active" : "past_due",
	});
};

export const listTenantsForOperator = async () => {
	const { operatorOrgId, deleteAfterDays } = getOlympeConfig();
	const organizations = await db.query.organization.findMany();
	const result = [];
	for (const org of organizations) {
		if (org.id === operatorOrgId) continue;
		const tenant = await getTenant(org.id);
		const usage = await getOrganizationUsage(org.id);
		const owner = await db.query.user.findFirst({
			where: eq(user.id, org.ownerId),
		});
		const [revenue] = await db
			.select({ value: count() })
			.from(olympePayment)
			.where(
				and(
					eq(olympePayment.organizationId, org.id),
					eq(olympePayment.status, "succeeded"),
				),
			);
		result.push({
			organizationId: org.id,
			name: org.name,
			ownerEmail: owner?.email ?? null,
			createdAt: org.createdAt,
			plan: tenant.plan,
			status: tenant.status,
			currentPeriodEnd: tenant.currentPeriodEnd,
			suspendedAt: tenant.suspendedAt,
			toDelete:
				tenant.status === "suspended" &&
				tenant.suspendedAt !== null &&
				Date.now() - tenant.suspendedAt.getTime() > deleteAfterDays * DAY_MS,
			usage,
			paymentsCount: Number(revenue?.value ?? 0),
		});
	}
	return result;
};

export const revenueSummary = async () => {
	const payments = await db.query.olympePayment.findMany({
		where: eq(olympePayment.status, "succeeded"),
	});
	const now = new Date();
	const monthStart = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
	);
	const byCurrency = (list: typeof payments) =>
		list.reduce<Record<string, number>>((acc, payment) => {
			acc[payment.currency] = (acc[payment.currency] ?? 0) + payment.amount;
			return acc;
		}, {});
	return {
		thisMonth: byCurrency(
			payments.filter((p) => p.paidAt && p.paidAt >= monthStart),
		),
		total: byCurrency(payments),
		simulated: payments.filter((p) => p.provider === "simulated").length,
	};
};

export const organizationName = async (organizationId: string) =>
	(
		await db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
		})
	)?.name ?? "";
