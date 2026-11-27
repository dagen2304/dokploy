import { db } from "@dokploy/server/db";
import {
	applications,
	compose,
	environments,
	libsql,
	mariadb,
	mongo,
	mysql,
	organization,
	postgres,
	projects,
	redis,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";
import { eq, isNull } from "drizzle-orm";
import { transferService } from "../transfer";
import { getOlympeConfig } from "./config";
import { tenantServerId } from "./placement";

const TABLES = {
	application: { table: applications, id: applications.applicationId },
	compose: { table: compose, id: compose.composeId },
	postgres: { table: postgres, id: postgres.postgresId },
	mysql: { table: mysql, id: mysql.mysqlId },
	mariadb: { table: mariadb, id: mariadb.mariadbId },
	mongo: { table: mongo, id: mongo.mongoId },
	redis: { table: redis, id: redis.redisId },
	libsql: { table: libsql, id: libsql.libsqlId },
} as const;

export type MigratableType = keyof typeof TABLES;

export const MIGRATABLE_TYPES = Object.keys(TABLES) as MigratableType[];

export type MigratableService = {
	serviceType: MigratableType;
	serviceId: string;
	name: string;
	appName: string;
	organizationId: string;
	organizationName: string;
};

// Client services created before the tenant server existed still run on the
// main server, next to the panel.
export const listServicesToMigrate = async (): Promise<MigratableService[]> => {
	const { operatorOrgId } = getOlympeConfig();
	if (!tenantServerId() || !operatorOrgId) return [];
	const services: MigratableService[] = [];
	for (const serviceType of MIGRATABLE_TYPES) {
		const { table, id } = TABLES[serviceType];
		const rows = await db
			.select({
				serviceId: id,
				name: table.name,
				appName: table.appName,
				organizationId: projects.organizationId,
				organizationName: organization.name,
			})
			.from(table)
			.innerJoin(
				environments,
				eq(environments.environmentId, table.environmentId),
			)
			.innerJoin(projects, eq(projects.projectId, environments.projectId))
			.innerJoin(organization, eq(organization.id, projects.organizationId))
			.where(isNull(table.serverId));
		for (const row of rows) {
			if (row.organizationId === operatorOrgId) continue;
			services.push({ serviceType, ...row });
		}
	}
	return services.sort(
		(a, b) =>
			a.organizationName.localeCompare(b.organizationName) ||
			a.name.localeCompare(b.name),
	);
};

const running = new Set<string>();

// Dokploy's own transfer: stop, copy volumes and mounts, move the Traefik
// configuration, deploy on the target. Source data is kept on the main server
// so a failed migration can be retried or rolled back by hand.
export const migrateToTenantServer = async (
	service: { serviceType: MigratableType; serviceId: string },
	log: (line: string) => void,
) => {
	const targetServerId = tenantServerId();
	if (!targetServerId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "OLYMPE_TENANT_SERVER_ID n'est pas défini sur le panel.",
		});
	}
	const candidate = (await listServicesToMigrate()).find(
		(item) =>
			item.serviceType === service.serviceType &&
			item.serviceId === service.serviceId,
	);
	if (!candidate) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Ce service n'est pas un service client à migrer.",
		});
	}
	if (running.has(service.serviceId)) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "Une migration de ce service est déjà en cours.",
		});
	}
	running.add(service.serviceId);
	try {
		return await transferService(
			{
				serviceType: service.serviceType,
				serviceId: service.serviceId,
				targetServerId,
				removeSourceData: false,
				organizationId: candidate.organizationId,
			},
			log,
		);
	} finally {
		running.delete(service.serviceId);
	}
};
