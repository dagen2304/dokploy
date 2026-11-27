import { db } from "@dokploy/server/db";
import { environments, projects } from "@dokploy/server/db/schema";
import { eq } from "drizzle-orm";
import { getOlympeConfig } from "./config";
import { isClientOrganization } from "./tenancy";

// Client workloads (and their builds) run on a dedicated server, so a
// container escape never lands on the host of the panel and its database.
export const tenantServerId = () => {
	const config = getOlympeConfig();
	return config.multiTenant ? config.tenantServerId : null;
};

// The tenant server belongs to the operator's organization: clients reach it
// only through their own services, never as a server they manage.
export const isTenantServerOf = (
	organizationId: string | null | undefined,
	serverId: string | null | undefined,
) =>
	Boolean(serverId) &&
	serverId === tenantServerId() &&
	isClientOrganization(organizationId);

const organizationIdOfEnvironment = async (environmentId: string) => {
	const [row] = await db
		.select({ organizationId: projects.organizationId })
		.from(environments)
		.innerJoin(projects, eq(projects.projectId, environments.projectId))
		.where(eq(environments.environmentId, environmentId))
		.limit(1);
	return row?.organizationId ?? null;
};

export const tenantServerIdForEnvironment = async (
	environmentId: string | null | undefined,
) => {
	const serverId = tenantServerId();
	if (!serverId || !environmentId) return null;
	const organizationId = await organizationIdOfEnvironment(environmentId);
	return isClientOrganization(organizationId) ? serverId : null;
};

export const placeTenantService = async <
	T extends { environmentId?: string | null; serverId?: string | null },
>(
	input: T,
): Promise<T> => {
	const serverId = await tenantServerIdForEnvironment(input.environmentId);
	return serverId ? { ...input, serverId } : input;
};
