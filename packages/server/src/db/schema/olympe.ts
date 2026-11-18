import { relations } from "drizzle-orm";
import {
	bigint,
	boolean,
	integer,
	pgTable,
	primaryKey,
	real,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { organization } from "./account";

// These tables are created by OLYMPE_BOOTSTRAP_SQL rather than drizzle
// migrations, so syncing upstream never conflicts with the migration journal.

export const olympePlan = pgTable("olympe_plan", {
	planId: text("plan_id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	slug: text("slug").notNull().unique(),
	name: text("name").notNull(),
	description: text("description").notNull().default(""),
	priceMonthly: integer("price_monthly").notNull().default(0),
	currency: text("currency").notNull().default("XAF"),
	cpu: real("cpu").notNull(),
	memoryMb: integer("memory_mb").notNull(),
	diskGb: integer("disk_gb").notNull(),
	maxServices: integer("max_services").notNull(),
	maxDatabases: integer("max_databases").notNull(),
	maxDomains: integer("max_domains").notNull(),
	maxConcurrentBuilds: integer("max_concurrent_builds").notNull().default(1),
	maxMembers: integer("max_members").notNull().default(1),
	aiDiagnosesPerMonth: integer("ai_diagnoses_per_month").notNull().default(0),
	isTrial: boolean("is_trial").notNull().default(false),
	trialDays: integer("trial_days").notNull().default(0),
	isPublic: boolean("is_public").notNull().default(true),
	active: boolean("active").notNull().default(true),
	sortOrder: integer("sort_order").notNull().default(0),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TenantStatus = "trial" | "active" | "past_due" | "suspended";

export const olympeTenant = pgTable("olympe_tenant", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	planId: text("plan_id")
		.notNull()
		.references(() => olympePlan.planId),
	status: text("status").$type<TenantStatus>().notNull().default("trial"),
	currentPeriodEnd: timestamp("current_period_end").notNull(),
	suspendedAt: timestamp("suspended_at"),
	lastReminderKey: text("last_reminder_key"),
	pendingPlanId: text("pending_plan_id"),
	suspendedSnapshot: text("suspended_snapshot"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PaymentStatus = "pending" | "succeeded" | "failed" | "canceled";

export const olympePayment = pgTable("olympe_payment", {
	paymentId: text("payment_id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	planId: text("plan_id")
		.notNull()
		.references(() => olympePlan.planId),
	months: integer("months").notNull(),
	amount: integer("amount").notNull(),
	currency: text("currency").notNull(),
	method: text("method").notNull(),
	provider: text("provider").notNull(),
	providerReference: text("provider_reference").notNull().unique(),
	status: text("status").$type<PaymentStatus>().notNull().default("pending"),
	invoiceNumber: text("invoice_number").unique(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	paidAt: timestamp("paid_at"),
});

export const olympeSignup = pgTable("olympe_signup", {
	signupId: text("signup_id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	email: text("email").notNull(),
	ip: text("ip").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// What each deployed service may consume, written at every deploy. Summing it
// per organization gives the quota usage without parsing compose files again.
export const olympeReservation = pgTable("olympe_reservation", {
	appName: text("app_name").primaryKey(),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	cpu: real("cpu").notNull(),
	memoryMb: integer("memory_mb").notNull(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const olympeDiskUsage = pgTable("olympe_disk_usage", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	bytes: bigint("bytes", { mode: "number" }).notNull(),
	warnedAt: timestamp("warned_at"),
	measuredAt: timestamp("measured_at").notNull().defaultNow(),
});

export const olympeCounter = pgTable(
	"olympe_counter",
	{
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		period: text("period").notNull(),
		value: integer("value").notNull().default(0),
	},
	(table) => [
		primaryKey({ columns: [table.organizationId, table.key, table.period] }),
	],
);

export const olympeTenantRelations = relations(olympeTenant, ({ one }) => ({
	plan: one(olympePlan, {
		fields: [olympeTenant.planId],
		references: [olympePlan.planId],
	}),
	organization: one(organization, {
		fields: [olympeTenant.organizationId],
		references: [organization.id],
	}),
}));

export const olympePaymentRelations = relations(olympePayment, ({ one }) => ({
	plan: one(olympePlan, {
		fields: [olympePayment.planId],
		references: [olympePlan.planId],
	}),
}));

export type OlympePlan = typeof olympePlan.$inferSelect;
export type OlympeTenant = typeof olympeTenant.$inferSelect;
export type OlympePayment = typeof olympePayment.$inferSelect;
