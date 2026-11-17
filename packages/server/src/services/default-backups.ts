import { IS_CLOUD } from "@dokploy/server/constants";
import { db } from "@dokploy/server/db";
import {
	destinations,
	mariadb,
	mysql,
	postgres,
} from "@dokploy/server/db/schema";
import { scheduleBackup } from "@dokploy/server/utils/backups/utils";
import { and, eq } from "drizzle-orm";
import { createBackup, findBackupById } from "./backup";

// KTC fork: every new database gets a backup without anyone thinking of it.
// Configured on the panel service, e.g.
//   docker service update --env-add DEFAULT_BACKUP_DESTINATION="S3 Bucket" dokploy

export type DefaultBackupDbType = "postgres" | "mysql" | "mariadb";

export const DEFAULT_BACKUP_DB_TYPES: DefaultBackupDbType[] = [
	"postgres",
	"mysql",
	"mariadb",
];

export type DefaultBackupConfig = {
	destinationName: string;
	schedule: string;
	keepLatestCount: number;
};

export const getDefaultBackupConfig = (
	env: Record<string, string | undefined> = process.env,
): DefaultBackupConfig | null => {
	const destinationName = env.DEFAULT_BACKUP_DESTINATION?.trim();
	if (!destinationName) return null;

	const schedule = env.DEFAULT_BACKUP_SCHEDULE?.trim() || "30 2 * * *";
	const keep = Number.parseInt(env.DEFAULT_BACKUP_KEEP ?? "", 10);
	return {
		destinationName,
		schedule,
		keepLatestCount: Number.isFinite(keep) && keep > 0 ? keep : 14,
	};
};

type DatabaseRow = {
	id: string;
	type: DefaultBackupDbType;
	name: string;
	appName: string;
	databaseName: string;
	projectName: string;
	organizationId: string;
	backupCount: number;
};

const loadDatabases = async (
	organizationId: string | null,
	only?: { type: DefaultBackupDbType; id: string },
): Promise<DatabaseRow[]> => {
	const scope = (type: DefaultBackupDbType) => !only || only.type === type;
	const withRelations = {
		backups: { columns: { backupId: true } },
		environment: {
			columns: {},
			with: { project: { columns: { name: true, organizationId: true } } },
		},
	} as const;

	const [pg, my, maria] = await Promise.all([
		scope("postgres")
			? db.query.postgres.findMany({
					where: only ? eq(postgres.postgresId, only.id) : undefined,
					with: withRelations,
				})
			: [],
		scope("mysql")
			? db.query.mysql.findMany({
					where: only ? eq(mysql.mysqlId, only.id) : undefined,
					with: withRelations,
				})
			: [],
		scope("mariadb")
			? db.query.mariadb.findMany({
					where: only ? eq(mariadb.mariadbId, only.id) : undefined,
					with: withRelations,
				})
			: [],
	]);

	const rows: DatabaseRow[] = [
		...pg.map((row) => ({
			...row,
			id: row.postgresId,
			type: "postgres" as const,
		})),
		...my.map((row) => ({ ...row, id: row.mysqlId, type: "mysql" as const })),
		...maria.map((row) => ({
			...row,
			id: row.mariadbId,
			type: "mariadb" as const,
		})),
	].map((row) => ({
		id: row.id,
		type: row.type,
		name: row.name,
		appName: row.appName,
		databaseName: row.databaseName,
		projectName: row.environment.project.name,
		organizationId: row.environment.project.organizationId,
		backupCount: row.backups.length,
	}));

	return organizationId
		? rows.filter((row) => row.organizationId === organizationId)
		: rows;
};

const findDefaultDestination = async (
	organizationId: string,
	config: DefaultBackupConfig,
) =>
	db.query.destinations.findFirst({
		where: and(
			eq(destinations.organizationId, organizationId),
			eq(destinations.name, config.destinationName),
		),
	});

const createDefaultBackup = async (
	database: DatabaseRow,
	destinationId: string,
	config: DefaultBackupConfig,
) => {
	const created = await createBackup({
		schedule: config.schedule,
		enabled: true,
		prefix: "/",
		destinationId,
		keepLatestCount: config.keepLatestCount,
		database: database.databaseName,
		databaseType: database.type,
		backupType: "database",
		[`${database.type}Id`]: database.id,
	});
	if (!IS_CLOUD) {
		scheduleBackup(await findBackupById(created.backupId));
	}
	return created;
};

/**
 * Called right after a database is created. Never throws: a missing default
 * destination must not make the database creation itself fail.
 */
export const ensureDefaultBackup = async (
	type: DefaultBackupDbType,
	id: string,
) => {
	try {
		const config = getDefaultBackupConfig();
		if (!config) return null;

		const [database] = await loadDatabases(null, { type, id });
		if (!database || database.backupCount > 0) return null;

		const destination = await findDefaultDestination(
			database.organizationId,
			config,
		);
		if (!destination) {
			console.warn(
				`Default backup skipped for ${database.appName}: destination "${config.destinationName}" not found`,
			);
			return null;
		}
		return await createDefaultBackup(
			database,
			destination.destinationId,
			config,
		);
	} catch (error) {
		console.error("Default backup creation failed:", error);
		return null;
	}
};

export const getDefaultBackupStatus = async (organizationId: string) => {
	const config = getDefaultBackupConfig();
	const destination = config
		? await findDefaultDestination(organizationId, config)
		: undefined;
	const databases = await loadDatabases(organizationId);
	return {
		config,
		destinationFound: !!destination,
		withoutBackup: databases
			.filter((database) => database.backupCount === 0)
			.map(({ id, type, name, projectName }) => ({
				id,
				type,
				name,
				projectName,
			})),
	};
};

export const backfillDefaultBackups = async (organizationId: string) => {
	const config = getDefaultBackupConfig();
	if (!config) {
		throw new Error(
			"DEFAULT_BACKUP_DESTINATION is not set on the panel service",
		);
	}
	const destination = await findDefaultDestination(organizationId, config);
	if (!destination) {
		throw new Error(
			`Backup destination "${config.destinationName}" not found in this organization`,
		);
	}

	const missing = (await loadDatabases(organizationId)).filter(
		(database) => database.backupCount === 0,
	);
	for (const database of missing) {
		await createDefaultBackup(database, destination.destinationId, config);
	}
	return {
		created: missing.map(({ name, projectName }) => ({ name, projectName })),
	};
};
