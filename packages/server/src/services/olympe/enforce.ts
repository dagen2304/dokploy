import { getOlympeConfig } from "./config";
import { ensureTenantNetwork } from "./network";
import {
	checkBuildPaths,
	checkComposeSpec,
	checkMounts,
	checkSwarmSettings,
	pickBuildPaths,
} from "./policy";
import {
	checkBudget,
	effectiveServiceLimits,
	getOrganizationUsage,
	isDiskFull,
	MB,
	NANO_CPUS,
	reserve,
	reservedByOthers,
	type ServiceLimits,
} from "./quotas";
import {
	findForeignAppNames,
	isClientOrganization,
	isMultiTenant,
	organizationIdOfService,
	tenantNetworkName,
} from "./tenancy";
import { getTenant, type TenantWithPlan } from "./tenants";

export class TenantPolicyError extends Error {
	constructor(problems: string[]) {
		super(
			problems.length === 1
				? `Olympe : ${problems[0]}`
				: `Olympe : ${problems.length} règles ne sont pas respectées :\n- ${problems.join("\n- ")}`,
		);
		this.name = "TenantPolicyError";
	}
}

const assertNoProblems = (problems: string[]) => {
	if (problems.length > 0) throw new TenantPolicyError(problems);
};

const assertDeployAllowed = async (tenant: TenantWithPlan) => {
	if (tenant.status === "suspended") {
		throw new TenantPolicyError([
			"votre espace est suspendu faute de paiement ; renouvelez votre forfait dans Facturation",
		]);
	}
	const usage = await getOrganizationUsage(tenant.organizationId);
	if (isDiskFull(tenant.plan, usage)) {
		throw new TenantPolicyError([
			`l'espace disque du forfait ${tenant.plan.name} (${tenant.plan.diskGb} Go) est plein ; supprimez des données ou changez de forfait`,
		]);
	}
};

type SwarmService = {
	appName: string;
	serverId?: string | null;
	cpuLimit?: string | null;
	memoryLimit?: string | null;
	replicas?: number | null;
	mounts?:
		| { type: string; hostPath?: string | null; volumeName?: string | null }[]
		| null;
	labelsSwarm?: Record<string, string> | null;
	endpointSpecSwarm?: { Ports?: unknown[] | null } | null;
	ports?: unknown[] | null;
	externalPort?: number | null;
	environment?: { project?: { organizationId?: string | null } | null } | null;
};

// Runs before every swarm service (application, preview, database) is created
// or updated. Operator services pass through untouched.
export const enforceTenantServicePolicy = async <T extends SwarmService>(
	service: T,
): Promise<T> => {
	if (!isMultiTenant()) return service;
	const organizationId = await organizationIdOfService(service);
	if (!organizationId || !isClientOrganization(organizationId)) return service;

	const config = getOlympeConfig();
	const tenant = await getTenant(organizationId);
	await assertDeployAllowed(tenant);

	assertNoProblems([
		...checkMounts(service.mounts ?? [], service.appName),
		...checkSwarmSettings(service, {
			allowPublishedPorts: config.allowPublishedPorts,
		}),
		...checkBuildPaths(pickBuildPaths(service as Record<string, unknown>)),
	]);

	const limits = effectiveServiceLimits(service, tenant.plan);
	const replicas = Math.max(1, service.replicas ?? 1);
	const total: ServiceLimits = {
		cpu: limits.cpu * replicas,
		memoryMb: limits.memoryMb * replicas,
	};
	const others = await reservedByOthers(organizationId, service.appName);
	const problem = checkBudget(tenant.plan, others, total);
	if (problem) throw new TenantPolicyError([problem]);

	await ensureTenantNetwork(organizationId, service.serverId);
	await reserve(organizationId, service.appName, total);

	return {
		...service,
		cpuLimit: String(Math.round(limits.cpu * NANO_CPUS)),
		memoryLimit: String(limits.memoryMb * MB),
	};
};

const UNITS: Record<string, number> = {
	b: 1 / MB,
	k: 1 / 1024,
	kb: 1 / 1024,
	m: 1,
	mb: 1,
	g: 1024,
	gb: 1024,
};

export const parseComposeMemoryMb = (value: unknown): number | null => {
	if (typeof value === "number")
		return value > 0 ? Math.ceil(value / MB) : null;
	if (typeof value !== "string") return null;
	const match = value
		.trim()
		.toLowerCase()
		.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/);
	if (!match) return null;
	const amount = Number.parseFloat(match[1] ?? "");
	const unit = match[2] || "b";
	const factor = UNITS[unit] ?? UNITS[unit.replace(/i?b$/, "")];
	if (!factor || !(amount > 0)) return null;
	return Math.ceil(amount * factor);
};

export const parseComposeCpus = (value: unknown): number | null => {
	const parsed =
		typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

type ComposeSpecLike = {
	services?: Record<string, any>;
	networks?: Record<string, any>;
	[key: string]: any;
};

const namesUsedBy = (spec: ComposeSpecLike) => {
	const names: string[] = [];
	for (const [name, service] of Object.entries(spec.services ?? {})) {
		names.push(name);
		if (typeof service?.container_name === "string")
			names.push(service.container_name);
		if (typeof service?.hostname === "string") names.push(service.hostname);
		const networks = service?.networks;
		if (networks && !Array.isArray(networks)) {
			for (const config of Object.values(networks)) {
				const aliases = (config as { aliases?: unknown })?.aliases;
				if (Array.isArray(aliases)) names.push(...aliases.map(String));
			}
		}
	}
	return names;
};

// Applies the per-service CPU/RAM limits to a compose spec and returns what
// the whole compose reserves.
export const applyComposeLimits = (
	spec: ComposeSpecLike,
	tenant: TenantWithPlan,
): ServiceLimits => {
	const total: ServiceLimits = { cpu: 0, memoryMb: 0 };
	for (const service of Object.values(spec.services ?? {})) {
		if (!service || typeof service !== "object") continue;
		service.deploy ??= {};
		service.deploy.resources ??= {};
		const current = service.deploy.resources.limits ?? {};
		const requestedCpu =
			parseComposeCpus(current.cpus) ?? parseComposeCpus(service.cpus);
		const requestedMemory =
			parseComposeMemoryMb(current.memory) ??
			parseComposeMemoryMb(service.mem_limit);
		const limits = effectiveServiceLimits(
			{
				cpuLimit: requestedCpu
					? String(Math.round(requestedCpu * NANO_CPUS))
					: null,
				memoryLimit: requestedMemory ? String(requestedMemory * MB) : null,
			},
			tenant.plan,
		);
		// Compose refuses mem_limit/cpus when they differ from deploy limits.
		delete service.mem_limit;
		delete service.cpus;
		service.deploy.resources.limits = {
			...current,
			cpus: String(limits.cpu),
			memory: `${limits.memoryMb}M`,
		};
		const replicas = Math.max(
			1,
			Number.parseInt(String(service.deploy.replicas ?? 1), 10) || 1,
		);
		total.cpu += limits.cpu * replicas;
		total.memoryMb += limits.memoryMb * replicas;
	}
	return total;
};

export const replaceNetworkName = (
	spec: ComposeSpecLike,
	from: string,
	to: string,
) => {
	for (const service of Object.values(spec.services ?? {})) {
		if (!service || typeof service !== "object") continue;
		const networks = service.networks;
		if (Array.isArray(networks)) {
			service.networks = networks.map((name: string) =>
				name === from ? to : name,
			);
		} else if (networks && typeof networks === "object" && from in networks) {
			networks[to] = networks[from];
			delete networks[from];
		}
		for (const holder of [service, service.deploy]) {
			const labels = holder?.labels;
			if (Array.isArray(labels)) {
				holder.labels = labels.map((label: string) =>
					label.replace(
						new RegExp(`^(traefik\\.(?:docker|swarm)\\.network)=${from}$`),
						`$1=${to}`,
					),
				);
			} else if (labels && typeof labels === "object") {
				for (const key of ["traefik.docker.network", "traefik.swarm.network"]) {
					if (labels[key] === from) labels[key] = to;
				}
			}
		}
	}
	if (spec.networks && from in spec.networks) {
		spec.networks[to] = { ...spec.networks[from], external: true, name: to };
		delete spec.networks[from];
	}
};

type ComposeLike = {
	appName: string;
	serverId?: string | null;
	environment?: { project?: { organizationId?: string | null } | null } | null;
};

// The user's compose, before Olympe adds its own labels and networks.
export const checkTenantCompose = async (
	compose: ComposeLike & Record<string, unknown>,
	spec: ComposeSpecLike,
): Promise<TenantWithPlan | null> => {
	if (!isMultiTenant()) return null;
	const organizationId = await organizationIdOfService(compose);
	if (!organizationId || !isClientOrganization(organizationId)) return null;

	const config = getOlympeConfig();
	const tenant = await getTenant(organizationId);
	await assertDeployAllowed(tenant);

	const problems = [
		...checkComposeSpec(spec, {
			allowPublishedPorts: config.allowPublishedPorts,
		}),
		...checkBuildPaths(pickBuildPaths(compose)),
	];
	// An isolated compose joins the external network named by its suffix: any
	// other name than its own would be someone else's network.
	if (
		compose.isolatedDeployment &&
		typeof compose.suffix === "string" &&
		compose.suffix &&
		compose.suffix !== compose.appName
	) {
		problems.push(
			"le suffixe d'un déploiement isolé doit rester vide sur Olympe",
		);
	}
	for (const [name, service] of Object.entries(spec.services ?? {})) {
		const containerName = service?.container_name;
		if (
			typeof containerName === "string" &&
			/^(dokploy|olympe)/i.test(containerName)
		) {
			problems.push(
				`service « ${name} » : container_name « ${containerName} » est réservé`,
			);
		}
	}
	const foreign = await findForeignAppNames(namesUsedBy(spec), organizationId);
	for (const name of foreign) {
		problems.push(
			`le nom « ${name} » est déjà utilisé par un autre espace, renommez ce service`,
		);
	}
	assertNoProblems(problems);
	return tenant;
};

// The final compose, after Olympe added its labels: moves it from
// dokploy-network to the client's own network and applies the quotas.
export const finalizeTenantCompose = async (
	compose: ComposeLike,
	spec: ComposeSpecLike,
	tenant: TenantWithPlan,
) => {
	const network = tenantNetworkName(tenant.organizationId);
	replaceNetworkName(spec, "dokploy-network", network);

	const total = applyComposeLimits(spec, tenant);
	const others = await reservedByOthers(tenant.organizationId, compose.appName);
	const problem = checkBudget(tenant.plan, others, total);
	if (problem) throw new TenantPolicyError([problem]);

	await ensureTenantNetwork(tenant.organizationId, compose.serverId);
	await reserve(tenant.organizationId, compose.appName, total);
	return spec;
};
