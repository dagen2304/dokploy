import { db } from "@dokploy/server/db";
import {
	applications,
	compose,
	environments,
	libsql,
	mariadb,
	mongo,
	mysql,
	postgres,
	previewDeployments,
	projects,
	redis,
} from "@dokploy/server/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { getOlympeConfig } from "./config";
import { normalizeHost } from "./policy";

export const isMultiTenant = () => getOlympeConfig().multiTenant;

export const isOperatorOrganization = (organizationId?: string | null) => {
	const { multiTenant, operatorOrgId } = getOlympeConfig();
	return !multiTenant || organizationId === operatorOrgId;
};

export const isClientOrganization = (organizationId?: string | null) =>
	Boolean(organizationId) && !isOperatorOrganization(organizationId);

export const tenantNetworkName = (organizationId: string) =>
	`olympe-org-${organizationId.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;

const SERVICE_TABLES = [
	applications,
	compose,
	postgres,
	mysql,
	mariadb,
	mongo,
	redis,
	libsql,
] as const;

export const findOrganizationIdByAppName = async (
	appName: string,
): Promise<string | null> => {
	for (const table of SERVICE_TABLES) {
		const [row] = await db
			.select({ organizationId: projects.organizationId })
			.from(table)
			.innerJoin(
				environments,
				eq(environments.environmentId, table.environmentId),
			)
			.innerJoin(projects, eq(projects.projectId, environments.projectId))
			.where(eq(table.appName, appName))
			.limit(1);
		if (row) return row.organizationId;
	}
	const [preview] = await db
		.select({ organizationId: projects.organizationId })
		.from(previewDeployments)
		.innerJoin(
			applications,
			eq(applications.applicationId, previewDeployments.applicationId),
		)
		.innerJoin(
			environments,
			eq(environments.environmentId, applications.environmentId),
		)
		.innerJoin(projects, eq(projects.projectId, environments.projectId))
		.where(eq(previewDeployments.appName, appName))
		.limit(1);
	return preview?.organizationId ?? null;
};

type ServiceWithOrg = {
	appName: string;
	environment?: { project?: { organizationId?: string | null } | null } | null;
};

export const organizationIdOfService = async (service: ServiceWithOrg) =>
	service.environment?.project?.organizationId ??
	(await findOrganizationIdByAppName(service.appName));

// appNames owned by an organization other than `organizationId`, among `names`.
// Used to stop a client from naming a compose service after someone else's
// app: Traefik resolves applications by DNS name on every network it joins.
export const findForeignAppNames = async (
	names: string[],
	organizationId: string,
): Promise<string[]> => {
	const unique = [...new Set(names.filter(Boolean))];
	if (unique.length === 0) return [];
	const foreign: string[] = [];
	for (const table of SERVICE_TABLES) {
		const rows = await db
			.select({
				appName: table.appName,
				organizationId: projects.organizationId,
			})
			.from(table)
			.innerJoin(
				environments,
				eq(environments.environmentId, table.environmentId),
			)
			.innerJoin(projects, eq(projects.projectId, environments.projectId))
			.where(inArray(table.appName, unique));
		for (const row of rows) {
			if (row.organizationId !== organizationId) foreign.push(row.appName);
		}
	}
	return foreign;
};

// Organizations already using `host`, through any application, compose or preview.
export const findDomainOwners = async (host: string): Promise<string[]> => {
	const rows = await db.execute<{ organizationId: string | null }>(sql`
		SELECT DISTINCT COALESCE(pa."organizationId", pc."organizationId", pp."organizationId") AS "organizationId"
		FROM "domain" d
		LEFT JOIN "application" a ON a."applicationId" = d."applicationId"
		LEFT JOIN "environment" ea ON ea."environmentId" = a."environmentId"
		LEFT JOIN "project" pa ON pa."projectId" = ea."projectId"
		LEFT JOIN "compose" c ON c."composeId" = d."composeId"
		LEFT JOIN "environment" ec ON ec."environmentId" = c."environmentId"
		LEFT JOIN "project" pc ON pc."projectId" = ec."projectId"
		LEFT JOIN "preview_deployments" pd ON pd."previewDeploymentId" = d."previewDeploymentId"
		LEFT JOIN "application" ap ON ap."applicationId" = pd."applicationId"
		LEFT JOIN "environment" ep ON ep."environmentId" = ap."environmentId"
		LEFT JOIN "project" pp ON pp."projectId" = ep."projectId"
		WHERE lower(d."host") = ${normalizeHost(host)}
	`);
	return [...rows]
		.map((row) => row.organizationId)
		.filter((value): value is string => Boolean(value));
};
