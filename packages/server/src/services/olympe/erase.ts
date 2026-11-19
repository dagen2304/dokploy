import path from "node:path";
import { paths } from "@dokploy/server/constants";
import {
	execAsync,
	execAsyncRemote,
} from "@dokploy/server/utils/process/execAsync";
import { removeTraefikConfig } from "@dokploy/server/utils/traefik/application";
import { quote } from "shell-quote";
import { deleteTrashItem, listTrash } from "../trash";
import { ownerAppName } from "./jobs";
import { composesOf, swarmServicesOf } from "./suspension";
import { isClientOrganization, tenantNetworkName } from "./tenancy";

const run = async (serverId: string | null, command: string) =>
	serverId ? execAsyncRemote(serverId, command) : execAsync(command);

const quietly = async (label: string, task: () => Promise<unknown>) => {
	try {
		await task();
	} catch (error) {
		console.error(`[olympe] erase ${label}`, error);
	}
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Volumes can only go once their containers have stopped, which swarm does
// asynchronously after `service rm`: retry a few times in the background.
const removeLocalVolumes = async (appNames: string[], network: string) => {
	for (let attempt = 0; attempt < 4; attempt++) {
		await sleep(20_000);
		let remaining = 0;
		try {
			const { stdout } = await execAsync(
				"docker volume ls --format '{{.Name}}'",
			);
			for (const volume of stdout.split("\n").map((line) => line.trim())) {
				if (!volume || !ownerAppName(volume, appNames)) continue;
				try {
					await execAsync(`docker volume rm ${quote([volume])}`);
				} catch {
					remaining++;
				}
			}
		} catch (error) {
			console.error("[olympe] erase volumes", error);
		}
		if (remaining === 0) break;
	}
	await quietly("network", async () => {
		await execAsync(
			`docker network disconnect -f ${quote([network])} dokploy-traefik || true`,
		);
		await execAsync(`docker network rm ${quote([network])}`);
	});
};

// Called before a client organization is deleted (by its owner, or with the
// owner's account). The database rows go by cascade; this removes what lives
// outside the database: running services, their files, volumes and trash.
// Volumes on a client's own remote server stay: that disk is theirs.
export const eraseClientSpace = async (organizationId: string) => {
	if (!isClientOrganization(organizationId)) return;

	const services = await swarmServicesOf(organizationId);
	const composes = await composesOf(organizationId);

	for (const service of services) {
		const { APPLICATIONS_PATH, LOGS_PATH } = paths(!!service.serverId);
		await quietly(service.appName, async () => {
			await run(
				service.serverId,
				`docker service rm ${quote([service.appName])} || true`,
			);
			await removeTraefikConfig(service.appName, service.serverId);
			await run(
				service.serverId,
				`rm -rf ${quote([path.join(APPLICATIONS_PATH, service.appName)])} ${quote([path.join(LOGS_PATH, service.appName)])}`,
			);
		});
	}

	for (const item of composes) {
		const { COMPOSE_PATH, LOGS_PATH } = paths(!!item.serverId);
		await quietly(item.appName, async () => {
			await run(
				item.serverId,
				item.composeType === "stack"
					? `docker stack rm ${quote([item.appName])} || true`
					: `docker compose -p ${quote([item.appName])} down --remove-orphans || true`,
			);
			await run(
				item.serverId,
				`rm -rf ${quote([path.join(COMPOSE_PATH, item.appName)])} ${quote([path.join(LOGS_PATH, item.appName)])}`,
			);
		});
	}

	await quietly("trash", async () => {
		for (const item of await listTrash(organizationId)) {
			await deleteTrashItem(item.id);
		}
	});

	const localAppNames = [
		...services.filter((service) => !service.serverId),
		...composes.filter((item) => !item.serverId),
	].map((item) => item.appName);
	void removeLocalVolumes(localAppNames, tenantNetworkName(organizationId));
};
