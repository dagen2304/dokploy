import { db } from "@dokploy/server/db";
import {
	applications,
	compose,
	environments,
	libsql,
	mariadb,
	mongo,
	mysql,
	olympeDiskUsage,
	olympeReservation,
	olympeSignup,
	postgres,
	projects,
	redis,
} from "@dokploy/server/db/schema";
import { execAsync } from "@dokploy/server/utils/process/execAsync";
import { eq, inArray, lt } from "drizzle-orm";
import { scheduleJob } from "node-schedule";
import { quote } from "shell-quote";
import { listTrash } from "../trash";
import { notifyOwners, runBillingCycle } from "./billing";
import { getOlympeConfig } from "./config";
import { isClientOrganization } from "./tenancy";
import { getTenant } from "./tenants";
import { closeTraefikInsecureApi } from "./traefik";

const UNIT_BYTES: Record<string, number> = {
	B: 1,
	KB: 1e3,
	MB: 1e6,
	GB: 1e9,
	TB: 1e12,
	KIB: 1024,
	MIB: 1024 ** 2,
	GIB: 1024 ** 3,
	TIB: 1024 ** 4,
};

export const parseDockerSize = (value: string): number => {
	const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/);
	if (!match) return 0;
	const unit = (match[2] || "B").toUpperCase();
	return Math.round(
		Number.parseFloat(match[1] ?? "0") * (UNIT_BYTES[unit] ?? 1),
	);
};

// The longest app name that the volume name starts with, followed by its end,
// "-" or "_". Dokploy names volumes "<appName>-data", compose "<appName>_<name>".
export const ownerAppName = (volume: string, appNames: string[]) => {
	let best: string | null = null;
	for (const appName of appNames) {
		if (
			(volume === appName ||
				volume.startsWith(`${appName}-`) ||
				volume.startsWith(`${appName}_`)) &&
			(!best || appName.length > best.length)
		) {
			best = appName;
		}
	}
	return best;
};

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

const localAppNamesByOrganization = async () => {
	const owners = new Map<string, string>();
	for (const table of SERVICE_TABLES) {
		const rows = await db
			.select({
				appName: table.appName,
				organizationId: projects.organizationId,
				serverId: table.serverId,
			})
			.from(table)
			.innerJoin(
				environments,
				eq(environments.environmentId, table.environmentId),
			)
			.innerJoin(projects, eq(projects.projectId, environments.projectId));
		for (const row of rows) {
			if (!row.serverId && isClientOrganization(row.organizationId)) {
				owners.set(row.appName, row.organizationId);
			}
		}
	}
	return owners;
};

// Volumes on the main server only: a client's own remote server is its disk.
export const measureDiskUsage = async () => {
	const owners = await localAppNamesByOrganization();
	if (owners.size === 0) return;

	const { stdout } = await execAsync(
		"docker system df -v --format '{{json .Volumes}}'",
	);
	const volumes = JSON.parse(stdout.trim() || "[]") as {
		Name: string;
		Size: string;
	}[];
	const totals = new Map<string, number>();
	const appNames = [...owners.keys()];
	for (const volume of volumes) {
		const appName = ownerAppName(volume.Name, appNames);
		if (!appName) continue;
		const organizationId = owners.get(appName)!;
		totals.set(
			organizationId,
			(totals.get(organizationId) ?? 0) + parseDockerSize(volume.Size),
		);
	}

	const { diskWarnPercent } = getOlympeConfig();
	for (const organizationId of new Set(owners.values())) {
		const bytes = totals.get(organizationId) ?? 0;
		const previous = await db.query.olympeDiskUsage.findFirst({
			where: eq(olympeDiskUsage.organizationId, organizationId),
		});
		const tenant = await getTenant(organizationId);
		const limit = tenant.plan.diskGb * 1024 ** 3;
		const overWarn = bytes >= (limit * diskWarnPercent) / 100;
		let warnedAt = overWarn ? (previous?.warnedAt ?? null) : null;
		if (overWarn && !previous?.warnedAt) {
			warnedAt = new Date();
			await notifyOwners(
				organizationId,
				"espace disque presque plein",
				`<p>Vos volumes utilisent ${(bytes / 1024 ** 3).toFixed(1)} Go sur les ${tenant.plan.diskGb} Go de votre forfait ${tenant.plan.name}.</p>
<p>Au-delà de 100 %, les nouveaux déploiements seront bloqués (ce qui tourne continue). Faites du ménage ou passez à un forfait supérieur.</p>`,
			);
		}
		await db
			.insert(olympeDiskUsage)
			.values({ organizationId, bytes, warnedAt, measuredAt: new Date() })
			.onConflictDoUpdate({
				target: olympeDiskUsage.organizationId,
				set: { bytes, warnedAt, measuredAt: new Date() },
			});
	}
};

// Sign-up records only serve to stop repeated trials; they are not kept forever.
export const purgeOldSignups = async (now = new Date()) => {
	const { signupRetentionDays } = getOlympeConfig();
	const limit = new Date(
		now.getTime() - signupRetentionDays * 24 * 60 * 60 * 1000,
	);
	await db.delete(olympeSignup).where(lt(olympeSignup.createdAt, limit));
};

export const selectOrphanVolumes = (
	volumes: string[],
	goneAppNames: string[],
	liveAppNames: Iterable<string>,
) => {
	const live = [...liveAppNames];
	return volumes
		.map((volume) => volume.trim())
		.filter(
			(volume) =>
				volume &&
				ownerAppName(volume, goneAppNames) &&
				// A longer live name that shares the prefix keeps its volume.
				!ownerAppName(volume, live),
		);
};

// Volumes of client services deleted more than the trash period ago: nothing
// can restore them any more and they no longer count in any quota. Only names
// Olympe once reserved for a client are considered, so operator volumes and
// volumes created outside Olympe are never touched.
export const removeOrphanClientVolumes = async () => {
	const reservations = await db.query.olympeReservation.findMany({
		columns: { appName: true, organizationId: true },
	});
	if (reservations.length === 0) return [];

	const live = new Set<string>();
	for (const table of SERVICE_TABLES) {
		const rows = await db.select({ appName: table.appName }).from(table);
		for (const row of rows) live.add(row.appName);
	}
	const organizations = new Set(reservations.map((row) => row.organizationId));
	for (const organizationId of organizations) {
		for (const item of await listTrash(organizationId)) live.add(item.appName);
	}

	const gone = reservations
		.map((row) => row.appName)
		.filter((appName) => !live.has(appName));
	if (gone.length === 0) return [];

	const { stdout } = await execAsync("docker volume ls --format '{{.Name}}'");
	const removed: string[] = [];
	for (const volume of selectOrphanVolumes(stdout.split("\n"), gone, live)) {
		try {
			await execAsync(`docker volume rm ${quote([volume])}`);
			removed.push(volume);
		} catch (error) {
			console.error(`[olympe] orphan volume ${volume}`, error);
		}
	}
	await db
		.delete(olympeReservation)
		.where(inArray(olympeReservation.appName, gone));
	return removed;
};

export const initOlympeJobs = () => {
	if (!getOlympeConfig().multiTenant) return;
	closeTraefikInsecureApi().catch((error) =>
		console.error("[olympe] closing the Traefik API", error),
	);
	scheduleJob("olympe-billing-cycle", "7 * * * *", () =>
		runBillingCycle().catch((error) =>
			console.error("[olympe] billing cycle", error),
		),
	);
	scheduleJob("olympe-signup-purge", "17 3 * * *", () =>
		purgeOldSignups().catch((error) =>
			console.error("[olympe] signup purge", error),
		),
	);
	scheduleJob("olympe-orphan-volumes", "27 4 * * *", () =>
		removeOrphanClientVolumes().catch((error) =>
			console.error("[olympe] orphan volumes", error),
		),
	);
	scheduleJob("olympe-disk-usage", "37 * * * *", () =>
		measureDiskUsage().catch((error) =>
			console.error("[olympe] disk usage", error),
		),
	);
};
