import { getRemoteDocker } from "@dokploy/server/utils/servers/remote-docker";
import { tenantNetworkName } from "./tenancy";

const TRAEFIK_CONTAINER = "dokploy-traefik";

const isNotFound = (error: unknown) =>
	typeof error === "object" &&
	error !== null &&
	"statusCode" in error &&
	(error as { statusCode?: number }).statusCode === 404;

const isAlreadyConnected = (error: unknown) =>
	error instanceof Error &&
	/already exists|already attached/i.test(error.message);

// Each client organization gets its own overlay network. Traefik joins it so
// it can still route to the client's services, but services of two clients
// never share a network, and none of them can reach dokploy-network (where the
// panel's own Postgres and Redis live).
export const ensureTenantNetwork = async (
	organizationId: string,
	serverId?: string | null,
) => {
	const name = tenantNetworkName(organizationId);
	const docker = await getRemoteDocker(serverId);

	try {
		await docker.getNetwork(name).inspect();
	} catch (error) {
		if (!isNotFound(error)) throw error;
		try {
			await docker.createNetwork({
				Name: name,
				Driver: "overlay",
				Attachable: true,
				Labels: { "olympe.organization": organizationId },
			});
		} catch (createError) {
			if (!isAlreadyConnected(createError)) throw createError;
		}
	}

	try {
		const traefik = await docker.getContainer(TRAEFIK_CONTAINER).inspect();
		const networks = traefik.NetworkSettings?.Networks ?? {};
		if (!(name in networks)) {
			await docker.getNetwork(name).connect({ Container: TRAEFIK_CONTAINER });
		}
	} catch (error) {
		if (isNotFound(error)) {
			console.warn(
				`[olympe] ${TRAEFIK_CONTAINER} not found; ${name} is not routed yet`,
			);
			return name;
		}
		if (!isAlreadyConnected(error)) throw error;
	}

	return name;
};

// Moves the already-running swarm services of a client from dokploy-network
// to its own network, without a rebuild. Compose stacks pick up the change at
// their next deploy, so they are only listed.
export const isolateExistingServices = async (
	services: { appName: string; serverId: string | null }[],
	organizationId: string,
) => {
	const moved: string[] = [];
	const failed: { appName: string; error: string }[] = [];
	for (const service of services) {
		try {
			const network = await ensureTenantNetwork(
				organizationId,
				service.serverId,
			);
			const docker = await getRemoteDocker(service.serverId);
			const handle = docker.getService(service.appName);
			const info = await handle.inspect();
			const spec = info.Spec;
			const current: { Target: string }[] =
				spec.TaskTemplate?.Networks ?? spec.Networks ?? [];
			const names = await Promise.all(
				current.map(async (entry) => {
					try {
						return (await docker.getNetwork(entry.Target).inspect())
							.Name as string;
					} catch {
						return entry.Target;
					}
				}),
			);
			if (!names.includes("dokploy-network") && names.includes(network))
				continue;
			const next = current.filter(
				(_, index) => names[index] !== "dokploy-network",
			);
			if (!names.includes(network)) next.push({ Target: network });
			await handle.update({
				...spec,
				version: Number.parseInt(String(info.Version?.Index ?? 0), 10),
				TaskTemplate: { ...spec.TaskTemplate, Networks: next },
			});
			moved.push(service.appName);
		} catch (error) {
			failed.push({
				appName: service.appName,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { moved, failed };
};
