import { db } from "@dokploy/server/db";
import {
	applications,
	compose,
	domains,
	environments,
	invitation,
	libsql,
	mariadb,
	member,
	mongo,
	mysql,
	type OlympePlan,
	olympeCounter,
	olympeDiskUsage,
	olympeReservation,
	postgres,
	projects,
	redis,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { getOlympeConfig } from "./config";
import { getTenant } from "./tenants";

export const NANO_CPUS = 1_000_000_000;
export const MB = 1024 * 1024;

export const cpuFromNano = (value?: string | null) => {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed / NANO_CPUS : null;
};

export const memoryMbFromBytes = (value?: string | null) => {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed / MB) : null;
};

export type ServiceLimits = { cpu: number; memoryMb: number };

export const defaultServiceLimits = (plan: OlympePlan): ServiceLimits => {
	const config = getOlympeConfig();
	return {
		cpu: Math.min(config.defaultServiceCpu, plan.cpu),
		memoryMb: Math.min(config.defaultServiceMemoryMb, plan.memoryMb),
	};
};

// Limits a single swarm service will run with: the user's own values when set,
// otherwise the plan default; never more than the whole plan.
export const effectiveServiceLimits = (
	service: { cpuLimit?: string | null; memoryLimit?: string | null },
	plan: OlympePlan,
): ServiceLimits => {
	const fallback = defaultServiceLimits(plan);
	return {
		cpu: Math.min(cpuFromNano(service.cpuLimit) ?? fallback.cpu, plan.cpu),
		memoryMb: Math.min(
			memoryMbFromBytes(service.memoryLimit) ?? fallback.memoryMb,
			plan.memoryMb,
		),
	};
};

export const formatMemory = (mb: number) =>
	mb >= 1024
		? `${Math.round((mb / 1024) * 10) / 10} Go`
		: `${Math.round(mb)} Mo`;

export const checkBudget = (
	plan: OlympePlan,
	others: ServiceLimits,
	requested: ServiceLimits,
): string | null => {
	const cpuLeft = Math.max(0, plan.cpu - others.cpu);
	const memoryLeft = Math.max(0, plan.memoryMb - others.memoryMb);
	if (requested.memoryMb > memoryLeft + 0.5) {
		return `mémoire insuffisante dans le forfait ${plan.name} : ce service demande ${formatMemory(requested.memoryMb)}, il vous reste ${formatMemory(memoryLeft)}`;
	}
	if (requested.cpu > cpuLeft + 0.001) {
		return `processeur insuffisant dans le forfait ${plan.name} : ce service demande ${requested.cpu} vCPU, il vous reste ${Math.round(cpuLeft * 100) / 100} vCPU`;
	}
	return null;
};

export const reservedByOthers = async (
	organizationId: string,
	appName: string,
): Promise<ServiceLimits> => {
	const [row] = await db
		.select({
			cpu: sql<number>`coalesce(sum(${olympeReservation.cpu}), 0)`,
			memoryMb: sql<number>`coalesce(sum(${olympeReservation.memoryMb}), 0)`,
		})
		.from(olympeReservation)
		.where(
			and(
				eq(olympeReservation.organizationId, organizationId),
				ne(olympeReservation.appName, appName),
			),
		);
	return { cpu: Number(row?.cpu ?? 0), memoryMb: Number(row?.memoryMb ?? 0) };
};

export const reserve = async (
	organizationId: string,
	appName: string,
	limits: ServiceLimits,
) => {
	await db
		.insert(olympeReservation)
		.values({ appName, organizationId, ...limits, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: olympeReservation.appName,
			set: { organizationId, ...limits, updatedAt: new Date() },
		});
};

const SERVICE_TABLES = { applications, compose } as const;
const DATABASE_TABLES = {
	postgres,
	mysql,
	mariadb,
	mongo,
	redis,
	libsql,
} as const;

const countInOrganization = async (
	table:
		| (typeof SERVICE_TABLES)[keyof typeof SERVICE_TABLES]
		| (typeof DATABASE_TABLES)[keyof typeof DATABASE_TABLES],
	organizationId: string,
) => {
	const [row] = await db
		.select({ value: count() })
		.from(table)
		.innerJoin(
			environments,
			eq(environments.environmentId, table.environmentId),
		)
		.innerJoin(projects, eq(projects.projectId, environments.projectId))
		.where(eq(projects.organizationId, organizationId));
	return Number(row?.value ?? 0);
};

const appNamesInOrganization = async (organizationId: string) => {
	const names: string[] = [];
	for (const table of [
		...Object.values(SERVICE_TABLES),
		...Object.values(DATABASE_TABLES),
	]) {
		const rows = await db
			.select({ appName: table.appName })
			.from(table)
			.innerJoin(
				environments,
				eq(environments.environmentId, table.environmentId),
			)
			.innerJoin(projects, eq(projects.projectId, environments.projectId))
			.where(eq(projects.organizationId, organizationId));
		names.push(...rows.map((row) => row.appName));
	}
	return names;
};

export type OrganizationUsage = {
	cpu: number;
	memoryMb: number;
	diskBytes: number;
	diskMeasuredAt: Date | null;
	services: number;
	databases: number;
	domains: number;
	members: number;
};

export const getOrganizationUsage = async (
	organizationId: string,
): Promise<OrganizationUsage> => {
	let services = 0;
	for (const table of Object.values(SERVICE_TABLES)) {
		services += await countInOrganization(table, organizationId);
	}
	let databases = 0;
	for (const table of Object.values(DATABASE_TABLES)) {
		databases += await countInOrganization(table, organizationId);
	}

	const liveNames = await appNamesInOrganization(organizationId);
	const reservations =
		liveNames.length > 0
			? await db
					.select({
						cpu: sql<number>`coalesce(sum(${olympeReservation.cpu}), 0)`,
						memoryMb: sql<number>`coalesce(sum(${olympeReservation.memoryMb}), 0)`,
					})
					.from(olympeReservation)
					.where(
						and(
							eq(olympeReservation.organizationId, organizationId),
							inArray(olympeReservation.appName, liveNames),
						),
					)
			: [{ cpu: 0, memoryMb: 0 }];

	const [domainRow] = await db
		.select({ value: count() })
		.from(domains)
		.leftJoin(
			applications,
			eq(applications.applicationId, domains.applicationId),
		)
		.leftJoin(compose, eq(compose.composeId, domains.composeId))
		.innerJoin(
			environments,
			sql`${environments.environmentId} = coalesce(${applications.environmentId}, ${compose.environmentId})`,
		)
		.innerJoin(projects, eq(projects.projectId, environments.projectId))
		.where(eq(projects.organizationId, organizationId));

	const [memberRow] = await db
		.select({ value: count() })
		.from(member)
		.where(eq(member.organizationId, organizationId));
	const [invitationRow] = await db
		.select({ value: count() })
		.from(invitation)
		.where(
			and(
				eq(invitation.organizationId, organizationId),
				eq(invitation.status, "pending"),
			),
		);

	const disk = await db.query.olympeDiskUsage.findFirst({
		where: eq(olympeDiskUsage.organizationId, organizationId),
	});

	return {
		cpu: Number(reservations[0]?.cpu ?? 0),
		memoryMb: Number(reservations[0]?.memoryMb ?? 0),
		diskBytes: disk?.bytes ?? 0,
		diskMeasuredAt: disk?.measuredAt ?? null,
		services,
		databases,
		domains: Number(domainRow?.value ?? 0),
		members: Number(memberRow?.value ?? 0) + Number(invitationRow?.value ?? 0),
	};
};

export type CreatableResource = "service" | "database" | "domain" | "member";

export const checkCreationLimit = (
	plan: OlympePlan,
	usage: OrganizationUsage,
	resource: CreatableResource,
): string | null => {
	const rules: Record<CreatableResource, [number, number, string]> = {
		service: [
			usage.services,
			plan.maxServices,
			"services (applications et Compose)",
		],
		database: [usage.databases, plan.maxDatabases, "bases de données"],
		domain: [usage.domains, plan.maxDomains, "domaines"],
		member: [usage.members, plan.maxMembers, "membres"],
	};
	const [used, max, label] = rules[resource];
	if (used >= max) {
		return `Le forfait ${plan.name} est limité à ${max} ${label}. Passez à un forfait supérieur dans Facturation.`;
	}
	return null;
};

export const isDiskFull = (
	plan: OlympePlan,
	usage: Pick<OrganizationUsage, "diskBytes">,
) => usage.diskBytes >= plan.diskGb * 1024 * MB;

export const assertWithinCreationLimit = (
	plan: OlympePlan,
	usage: OrganizationUsage,
	resource: CreatableResource,
) => {
	const problem = checkCreationLimit(plan, usage, resource);
	if (problem) throw new TRPCError({ code: "FORBIDDEN", message: problem });
};

// Build slots for the deployment queue: one key per client organization,
// limited by its plan. Operator deployments are not limited here.
export const tenantBuildSlot = async ({
	applicationId,
	composeId,
}: {
	applicationId?: string;
	composeId?: string;
}): Promise<{ key: string; limit: number } | null> => {
	const config = getOlympeConfig();
	if (!config.multiTenant || !config.buildConcurrencyEnforced) return null;
	const table = applicationId ? applications : composeId ? compose : null;
	const id = applicationId ?? composeId;
	if (!table || !id) return null;
	const idColumn = applicationId
		? applications.applicationId
		: compose.composeId;
	const [row] = await db
		.select({ organizationId: projects.organizationId })
		.from(table)
		.innerJoin(
			environments,
			eq(environments.environmentId, table.environmentId),
		)
		.innerJoin(projects, eq(projects.projectId, environments.projectId))
		.where(eq(idColumn, id))
		.limit(1);
	if (!row || row.organizationId === config.operatorOrgId) return null;
	const tenant = await getTenant(row.organizationId);
	return {
		key: row.organizationId,
		limit: Math.max(1, tenant.plan.maxConcurrentBuilds),
	};
};

export const currentPeriod = (now = new Date()) =>
	`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

// Atomically takes one unit of a monthly allowance; refuses once `limit` is reached.
export const consumeMonthlyQuota = async (
	organizationId: string,
	key: string,
	limit: number,
	now = new Date(),
) => {
	const refusal = () =>
		new TRPCError({
			code: "FORBIDDEN",
			message: `Vous avez utilisé les ${limit} diagnostics IA inclus ce mois-ci dans votre forfait.`,
		});
	if (limit <= 0) throw refusal();
	const period = currentPeriod(now);
	const [row] = await db
		.insert(olympeCounter)
		.values({ organizationId, key, period, value: 1 })
		.onConflictDoUpdate({
			target: [
				olympeCounter.organizationId,
				olympeCounter.key,
				olympeCounter.period,
			],
			set: { value: sql`${olympeCounter.value} + 1` },
			setWhere: sql`${olympeCounter.value} < ${limit}`,
		})
		.returning({ value: olympeCounter.value });
	if (!row) throw refusal();
	return row.value;
};
