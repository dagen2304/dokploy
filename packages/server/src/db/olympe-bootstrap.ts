import type { Sql } from "postgres";

export const OLYMPE_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS "olympe_plan" (
	"plan_id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_monthly" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'XAF' NOT NULL,
	"cpu" real NOT NULL,
	"memory_mb" integer NOT NULL,
	"disk_gb" integer NOT NULL,
	"max_services" integer NOT NULL,
	"max_databases" integer NOT NULL,
	"max_domains" integer NOT NULL,
	"max_concurrent_builds" integer DEFAULT 1 NOT NULL,
	"max_members" integer DEFAULT 1 NOT NULL,
	"ai_diagnoses_per_month" integer DEFAULT 0 NOT NULL,
	"is_trial" boolean DEFAULT false NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "olympe_tenant" (
	"organization_id" text PRIMARY KEY NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"plan_id" text NOT NULL REFERENCES "olympe_plan"("plan_id"),
	"status" text DEFAULT 'trial' NOT NULL,
	"current_period_end" timestamp NOT NULL,
	"suspended_at" timestamp,
	"last_reminder_key" text,
	"pending_plan_id" text,
	"suspended_snapshot" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "olympe_payment" (
	"payment_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"plan_id" text NOT NULL REFERENCES "olympe_plan"("plan_id"),
	"months" integer NOT NULL,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL UNIQUE,
	"status" text DEFAULT 'pending' NOT NULL,
	"invoice_number" text UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);

CREATE INDEX IF NOT EXISTS "olympe_payment_org_idx" ON "olympe_payment" ("organization_id");

CREATE TABLE IF NOT EXISTS "olympe_reservation" (
	"app_name" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"cpu" real NOT NULL,
	"memory_mb" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "olympe_reservation_org_idx" ON "olympe_reservation" ("organization_id");

CREATE TABLE IF NOT EXISTS "olympe_disk_usage" (
	"organization_id" text PRIMARY KEY NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"bytes" bigint NOT NULL,
	"warned_at" timestamp,
	"measured_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "olympe_counter" (
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"key" text NOT NULL,
	"period" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	PRIMARY KEY ("organization_id", "key", "period")
);

CREATE TABLE IF NOT EXISTS "olympe_signup" (
	"signup_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "olympe_signup_ip_idx" ON "olympe_signup" ("ip", "created_at");
`;

type SeedPlan = {
	slug: string;
	name: string;
	description: string;
	priceMonthly: number;
	cpu: number;
	memoryMb: number;
	diskGb: number;
	maxServices: number;
	maxDatabases: number;
	maxDomains: number;
	maxConcurrentBuilds: number;
	maxMembers: number;
	aiDiagnosesPerMonth: number;
	isTrial?: boolean;
	trialDays?: number;
	sortOrder: number;
};

// Starting catalogue in XAF for Central Africa. Seeded once with
// ON CONFLICT DO NOTHING: prices edited later from the operator page are kept.
export const DEFAULT_PLANS: SeedPlan[] = [
	{
		slug: "essai",
		name: "Essai",
		description: "14 jours gratuits pour découvrir Olympe",
		priceMonthly: 0,
		cpu: 0.5,
		memoryMb: 512,
		diskGb: 2,
		maxServices: 2,
		maxDatabases: 1,
		maxDomains: 2,
		maxConcurrentBuilds: 1,
		maxMembers: 1,
		aiDiagnosesPerMonth: 5,
		isTrial: true,
		trialDays: 14,
		sortOrder: 0,
	},
	{
		slug: "decouverte",
		name: "Découverte",
		description: "Un site vitrine ou un petit projet personnel",
		priceMonthly: 2500,
		cpu: 0.5,
		memoryMb: 1024,
		diskGb: 5,
		maxServices: 3,
		maxDatabases: 1,
		maxDomains: 3,
		maxConcurrentBuilds: 1,
		maxMembers: 1,
		aiDiagnosesPerMonth: 10,
		sortOrder: 1,
	},
	{
		slug: "starter",
		name: "Starter",
		description: "Une application avec sa base de données, en production",
		priceMonthly: 5000,
		cpu: 1,
		memoryMb: 2048,
		diskGb: 15,
		maxServices: 6,
		maxDatabases: 2,
		maxDomains: 5,
		maxConcurrentBuilds: 1,
		maxMembers: 2,
		aiDiagnosesPerMonth: 30,
		sortOrder: 2,
	},
	{
		slug: "pro",
		name: "Pro",
		description: "Plusieurs applications et une petite équipe",
		priceMonthly: 12500,
		cpu: 2,
		memoryMb: 4096,
		diskGb: 40,
		maxServices: 15,
		maxDatabases: 5,
		maxDomains: 15,
		maxConcurrentBuilds: 2,
		maxMembers: 5,
		aiDiagnosesPerMonth: 100,
		sortOrder: 3,
	},
	{
		slug: "business",
		name: "Business",
		description: "PME et agences qui hébergent les projets de leurs clients",
		priceMonthly: 30000,
		cpu: 4,
		memoryMb: 8192,
		diskGb: 100,
		maxServices: 40,
		maxDatabases: 15,
		maxDomains: 50,
		maxConcurrentBuilds: 3,
		maxMembers: 15,
		aiDiagnosesPerMonth: 300,
		sortOrder: 4,
	},
];

export const runOlympeBootstrap = async (sql: Sql) => {
	await sql.unsafe(OLYMPE_BOOTSTRAP_SQL);
	for (const plan of DEFAULT_PLANS) {
		await sql`
			INSERT INTO "olympe_plan" (
				"plan_id", "slug", "name", "description", "price_monthly", "currency",
				"cpu", "memory_mb", "disk_gb", "max_services", "max_databases",
				"max_domains", "max_concurrent_builds", "max_members",
				"ai_diagnoses_per_month", "is_trial", "trial_days", "sort_order"
			) VALUES (
				${`plan_${plan.slug}`}, ${plan.slug}, ${plan.name}, ${plan.description},
				${plan.priceMonthly}, 'XAF', ${plan.cpu}, ${plan.memoryMb}, ${plan.diskGb},
				${plan.maxServices}, ${plan.maxDatabases}, ${plan.maxDomains},
				${plan.maxConcurrentBuilds}, ${plan.maxMembers}, ${plan.aiDiagnosesPerMonth},
				${plan.isTrial ?? false}, ${plan.trialDays ?? 0}, ${plan.sortOrder}
			)
			ON CONFLICT ("slug") DO NOTHING
		`;
	}
};
