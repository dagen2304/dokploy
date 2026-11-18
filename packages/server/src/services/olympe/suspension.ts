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
	projects,
	redis,
} from "@dokploy/server/db/schema";
import {
	execAsync,
	execAsyncRemote,
} from "@dokploy/server/utils/process/execAsync";
import { eq } from "drizzle-orm";
import { quote } from "shell-quote";
import { getTenant, updateTenant } from "./tenants";

type ScaledService = {
	serverId: string | null;
	service: string;
	replicas: number;
};
type StoppedCompose = { serverId: string | null; appName: string };
export type SuspensionSnapshot = {
	services: ScaledService[];
	composes: StoppedCompose[];
};

const run = async (serverId: string | null, command: string) =>
	serverId ? execAsyncRemote(serverId, command) : execAsync(command);

const SWARM_TABLES = [
	applications,
	postgres,
	mysql,
	mariadb,
	mongo,
	redis,
	libsql,
] as const;

export const swarmServicesOf = async (organizationId: string) => {
	const rows: { appName: string; serverId: string | null }[] = [];
	for (const table of SWARM_TABLES) {
		const found = await db
			.select({ appName: table.appName, serverId: table.serverId })
			.from(table)
			.innerJoin(
				environments,
				eq(environments.environmentId, table.environmentId),
			)
			.innerJoin(projects, eq(projects.projectId, environments.projectId))
			.where(eq(projects.organizationId, organizationId));
		rows.push(...found);
	}
	return rows;
};

export const composesOf = async (organizationId: string) =>
	db
		.select({
			appName: compose.appName,
			serverId: compose.serverId,
			composeType: compose.composeType,
		})
		.from(compose)
		.innerJoin(
			environments,
			eq(environments.environmentId, compose.environmentId),
		)
		.innerJoin(projects, eq(projects.projectId, environments.projectId))
		.where(eq(projects.organizationId, organizationId));

const currentReplicas = async (serverId: string | null, service: string) => {
	try {
		const { stdout } = await run(
			serverId,
			`docker service inspect ${quote([service])} --format '{{if .Spec.Mode.Replicated}}{{.Spec.Mode.Replicated.Replicas}}{{else}}0{{end}}'`,
		);
		return Number.parseInt(stdout.trim(), 10) || 0;
	} catch {
		return 0;
	}
};

const stackServices = async (serverId: string | null, namespace: string) => {
	try {
		const { stdout } = await run(
			serverId,
			`docker service ls --filter ${quote([`label=com.docker.stack.namespace=${namespace}`])} --format '{{.Name}}'`,
		);
		return stdout
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
};

// Scales every service of the organization to zero and remembers how many
// replicas each had, so reactivation restores exactly what was running.
// Volumes and databases are untouched.
export const suspendOrganization = async (organizationId: string) => {
	const tenant = await getTenant(organizationId);
	if (tenant.status === "suspended") return;

	const snapshot: SuspensionSnapshot = { services: [], composes: [] };

	const targets: { serverId: string | null; service: string }[] = (
		await swarmServicesOf(organizationId)
	).map((row) => ({ serverId: row.serverId, service: row.appName }));

	for (const item of await composesOf(organizationId)) {
		if (item.composeType === "stack") {
			for (const service of await stackServices(item.serverId, item.appName)) {
				targets.push({ serverId: item.serverId, service });
			}
		} else {
			try {
				await run(
					item.serverId,
					`docker compose -p ${quote([item.appName])} stop`,
				);
				snapshot.composes.push({
					serverId: item.serverId,
					appName: item.appName,
				});
			} catch (error) {
				console.error(`[olympe] stop compose ${item.appName}`, error);
			}
		}
	}

	for (const target of targets) {
		const replicas = await currentReplicas(target.serverId, target.service);
		if (replicas === 0) continue;
		try {
			await run(
				target.serverId,
				`docker service scale ${quote([`${target.service}=0`])}`,
			);
			snapshot.services.push({ ...target, replicas });
		} catch (error) {
			console.error(`[olympe] scale down ${target.service}`, error);
		}
	}

	await updateTenant(organizationId, {
		status: "suspended",
		suspendedAt: new Date(),
		suspendedSnapshot: JSON.stringify(snapshot),
	});
};

export const resumeOrganization = async (organizationId: string) => {
	const tenant = await getTenant(organizationId);
	const snapshot: SuspensionSnapshot = tenant.suspendedSnapshot
		? JSON.parse(tenant.suspendedSnapshot)
		: { services: [], composes: [] };

	for (const item of snapshot.services) {
		try {
			await run(
				item.serverId,
				`docker service scale ${quote([`${item.service}=${item.replicas}`])}`,
			);
		} catch (error) {
			console.error(`[olympe] scale up ${item.service}`, error);
		}
	}
	for (const item of snapshot.composes) {
		try {
			await run(
				item.serverId,
				`docker compose -p ${quote([item.appName])} start`,
			);
		} catch (error) {
			console.error(`[olympe] start compose ${item.appName}`, error);
		}
	}

	await updateTenant(organizationId, {
		suspendedAt: null,
		suspendedSnapshot: null,
	});
};
