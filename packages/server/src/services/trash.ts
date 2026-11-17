import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { IS_CLOUD, paths } from "@dokploy/server/constants";
import { db } from "@dokploy/server/db";
import {
	applications,
	backups,
	compose,
	domains,
	environments,
	libsql,
	mariadb,
	mongo,
	mounts,
	mysql,
	patch,
	ports,
	postgres,
	redirects,
	redis,
	schedules,
	security,
	volumeBackups,
} from "@dokploy/server/db/schema";
import { decryptValue, encryptValue } from "@dokploy/server/lib/encryption";
import { scheduleBackup } from "@dokploy/server/utils/backups/utils";
import { scheduleJob } from "@dokploy/server/utils/schedules/utils";
import { createTraefikConfig } from "@dokploy/server/utils/traefik/application";
import { manageDomain } from "@dokploy/server/utils/traefik/domain";
import { createRedirectMiddleware } from "@dokploy/server/utils/traefik/redirect";
import { createSecurityMiddleware } from "@dokploy/server/utils/traefik/security";
import { scheduleVolumeBackup } from "@dokploy/server/utils/volume-backups/utils";
import { eq, getTableColumns, type Table } from "drizzle-orm";
import { findApplicationById } from "./application";
import { findBackupById } from "./backup";
import { findScheduleById } from "./schedule";

// KTC fork: deleted services are kept for TRASH_RETENTION_DAYS and can be
// restored. Snapshots live as encrypted files (no schema change, so upstream
// migrations never conflict). Deployment history is not kept; data in Docker
// volumes survives because deleting a service does not remove its volumes
// unless "delete volumes" is explicitly chosen (compose).

export const TRASH_RETENTION_DAYS = 7;

export const TRASH_SERVICE_TYPES = [
	"application",
	"compose",
	"postgres",
	"mysql",
	"mariadb",
	"mongo",
	"redis",
	"libsql",
] as const;
export type TrashServiceType = (typeof TRASH_SERVICE_TYPES)[number];

const SERVICE_TABLES: Record<TrashServiceType, Table> = {
	application: applications,
	compose,
	postgres,
	mysql,
	mariadb,
	mongo,
	redis,
	libsql,
};

const ID_FIELD: Record<TrashServiceType, string> = {
	application: "applicationId",
	compose: "composeId",
	postgres: "postgresId",
	mysql: "mysqlId",
	mariadb: "mariadbId",
	mongo: "mongoId",
	redis: "redisId",
	libsql: "libsqlId",
};

// Service-owned rows worth restoring. Deployments and preview deployments
// are history, not configuration, and their logs are already gone.
const CHILD_TABLES = {
	mounts,
	domains,
	ports,
	redirects,
	security,
	patch,
	schedules,
	backups,
	volumeBackups,
} satisfies Record<string, Table>;
type ChildKey = keyof typeof CHILD_TABLES;

type Row = Record<string, unknown>;

export type TrashSnapshot = {
	version: 1;
	type: TrashServiceType;
	id: string;
	name: string;
	appName: string;
	environmentId: string;
	organizationId: string;
	deletedAt: string;
	deletedBy: string | null;
	service: Row;
	children: Partial<Record<ChildKey, Row[]>>;
};

export type TrashItem = Pick<
	TrashSnapshot,
	"type" | "id" | "name" | "appName" | "environmentId" | "deletedAt"
> & { expiresAt: string };

const trashDir = () => path.join(paths().BASE_PATH, "trash");

const fileFor = (id: string) => {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid service id");
	return path.join(trashDir(), `${id}.trash`);
};

const columnOf = (table: Table, field: string) =>
	(getTableColumns(table) as Record<string, any>)[field];

/** Rows go through JSON, so timestamp columns come back as strings. */
export const reviveRow = (table: Table, row: Row): Row => {
	const columns = getTableColumns(table) as Record<
		string,
		{ dataType: string }
	>;
	const revived: Row = {};
	for (const [key, value] of Object.entries(row)) {
		const column = columns[key];
		if (!column) continue;
		revived[key] =
			column.dataType === "date" && typeof value === "string"
				? new Date(value)
				: value;
	}
	return revived;
};

export const expiresAt = (deletedAt: string) =>
	new Date(
		new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * 24 * 3600 * 1000,
	);

/** Snapshot a service and its configuration rows. Call before deleting it. */
export const moveServiceToTrash = async (
	type: TrashServiceType,
	id: string,
	deletedBy: string | null,
) => {
	const table = SERVICE_TABLES[type];
	const idField = ID_FIELD[type];
	const [service] = await db
		.select()
		.from(table)
		.where(eq(columnOf(table, idField), id));
	if (!service) return null;

	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, String(service.environmentId)),
		with: { project: { columns: { organizationId: true } } },
	});
	if (!environment) return null;

	const children: TrashSnapshot["children"] = {};
	for (const [key, childTable] of Object.entries(CHILD_TABLES) as [
		ChildKey,
		Table,
	][]) {
		const column = columnOf(childTable, idField);
		if (!column) continue;
		const rows = await db.select().from(childTable).where(eq(column, id));
		// Preview domains die with their preview deployments.
		const kept =
			key === "domains"
				? rows.filter((row) => !(row as Row).previewDeploymentId)
				: rows;
		if (kept.length > 0) children[key] = kept as Row[];
	}

	const snapshot: TrashSnapshot = {
		version: 1,
		type,
		id,
		name: String(service.name),
		appName: String(service.appName),
		environmentId: environment.environmentId,
		organizationId: environment.project.organizationId,
		deletedAt: new Date().toISOString(),
		deletedBy,
		service: service as Row,
		children,
	};

	await mkdir(trashDir(), { recursive: true, mode: 0o700 });
	// Env vars and passwords are inside: never store the snapshot in clear.
	await writeFile(fileFor(id), encryptValue(JSON.stringify(snapshot)), {
		mode: 0o600,
	});
	return snapshot;
};

const readSnapshot = async (id: string): Promise<TrashSnapshot | null> => {
	try {
		return JSON.parse(decryptValue(await readFile(fileFor(id), "utf8")));
	} catch {
		return null;
	}
};

export const deleteTrashItem = async (id: string) =>
	rm(fileFor(id), { force: true });

/** Lists one organization's trash, dropping expired snapshots on the way. */
export const listTrash = async (
	organizationId: string,
	environmentId?: string,
): Promise<TrashItem[]> => {
	let files: string[] = [];
	try {
		files = await readdir(trashDir());
	} catch {
		return [];
	}

	const items: TrashItem[] = [];
	for (const file of files.filter((f) => f.endsWith(".trash"))) {
		const snapshot = await readSnapshot(file.slice(0, -".trash".length));
		if (!snapshot) continue;
		const expiry = expiresAt(snapshot.deletedAt);
		if (expiry.getTime() < Date.now()) {
			await deleteTrashItem(snapshot.id);
			continue;
		}
		if (snapshot.organizationId !== organizationId) continue;
		if (environmentId && snapshot.environmentId !== environmentId) continue;
		items.push({
			type: snapshot.type,
			id: snapshot.id,
			name: snapshot.name,
			appName: snapshot.appName,
			environmentId: snapshot.environmentId,
			deletedAt: snapshot.deletedAt,
			expiresAt: expiry.toISOString(),
		});
	}
	return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
};

export class TrashRestoreError extends Error {}

export const getTrashSnapshot = async (id: string, organizationId: string) => {
	const snapshot = await readSnapshot(id);
	if (!snapshot || snapshot.organizationId !== organizationId) return null;
	return snapshot;
};

/**
 * Re-inserts the service with its original ids and app name, so Docker
 * volumes (named after the app) and S3 backups (stored under it) line up
 * again. The service must then be deployed to run.
 */
export const restoreFromTrash = async (id: string, organizationId: string) => {
	const snapshot = await getTrashSnapshot(id, organizationId);
	if (!snapshot) throw new TrashRestoreError("Item not found in the trash");
	if (expiresAt(snapshot.deletedAt).getTime() < Date.now()) {
		await deleteTrashItem(id);
		throw new TrashRestoreError("This item has expired");
	}

	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, snapshot.environmentId),
	});
	if (!environment) {
		throw new TrashRestoreError(
			"The environment of this service no longer exists",
		);
	}

	const table = SERVICE_TABLES[snapshot.type];
	await db.transaction(async (tx) => {
		for (const serviceTable of Object.values(SERVICE_TABLES)) {
			const [clash] = await tx
				.select()
				.from(serviceTable)
				.where(eq(columnOf(serviceTable, "appName"), snapshot.appName));
			if (clash) {
				throw new TrashRestoreError(
					`A service named ${snapshot.appName} already exists`,
				);
			}
		}

		await tx.insert(table).values(reviveRow(table, snapshot.service) as any);
		for (const [key, rows] of Object.entries(snapshot.children) as [
			ChildKey,
			Row[],
		][]) {
			const childTable = CHILD_TABLES[key];
			for (const row of rows) {
				await tx.insert(childTable).values(reviveRow(childTable, row) as any);
			}
		}
	});

	await deleteTrashItem(id);
	await reattachRuntime(snapshot);
	return snapshot;
};

// Best effort: the rows are back either way, and a deploy recreates the rest.
const reattachRuntime = async (snapshot: TrashSnapshot) => {
	const tasks: (() => Promise<unknown>)[] = [];

	if (snapshot.type === "application") {
		tasks.push(async () => {
			const application = await findApplicationById(snapshot.id);
			if (!application.serverId) createTraefikConfig(application.appName);
			for (const domain of application.domains) {
				await manageDomain(application, domain);
			}
			for (const rule of application.security) {
				await createSecurityMiddleware(application, rule);
			}
			for (const rule of application.redirects) {
				await createRedirectMiddleware(application, rule);
			}
		});
	}

	if (!IS_CLOUD) {
		for (const backup of snapshot.children.backups ?? []) {
			if (backup.enabled) {
				tasks.push(async () =>
					scheduleBackup(await findBackupById(String(backup.backupId))),
				);
			}
		}
		for (const schedule of snapshot.children.schedules ?? []) {
			if (schedule.enabled) {
				tasks.push(async () =>
					scheduleJob(await findScheduleById(String(schedule.scheduleId))),
				);
			}
		}
		for (const volumeBackup of snapshot.children.volumeBackups ?? []) {
			if (volumeBackup.enabled) {
				tasks.push(() =>
					scheduleVolumeBackup(String(volumeBackup.volumeBackupId)),
				);
			}
		}
	}

	for (const task of tasks) {
		try {
			await task();
		} catch (error) {
			console.error(`Trash restore of ${snapshot.appName}:`, error);
		}
	}
};
