import { db } from "@dokploy/server/db";
import {
	applications,
	compose,
	libsql,
	mariadb,
	mongo,
	mysql,
	postgres,
	redis,
	volumeBackups,
} from "@dokploy/server/db/schema";
import { getRemoteDocker } from "@dokploy/server/utils/servers/remote-docker";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getOlympeConfig } from "./config";
import { checkDomainHost, isOwnVolumeName } from "./policy";
import {
	assertWithinCreationLimit,
	type CreatableResource,
	getOrganizationUsage,
} from "./quotas";
import { hasSelfSignedUp } from "./signup";
import {
	findDomainOwners,
	findOrganizationIdByAppName,
	isClientOrganization,
} from "./tenancy";
import { getTenant } from "./tenants";

// Every tRPC router must be listed here. A router missing from this table is
// refused to clients, so a new router arriving from upstream stays closed
// until someone decides who may use it.
export type RouterPolicy =
	| "client"
	| "operator"
	| { allow: readonly string[] }
	| "checked";

export const ROUTER_POLICY: Record<string, RouterPolicy> = {
	admin: "operator",
	ai: "client",
	application: "checked",
	auditLog: "operator",
	backup: "checked",
	bitbucket: "client",
	certificates: { allow: ["all", "one"] },
	cluster: "operator",
	compose: "checked",
	customRole: "operator",
	deployDiagnosis: "client",
	deployment: "client",
	destination: "client",
	dnsProvider: { allow: ["all"] },
	docker: "checked",
	dockerDiskUsage: "operator",
	dockerImage: "operator",
	dockerVolume: "operator",
	domain: "checked",
	environment: "client",
	forwardAuth: "operator",
	gitProvider: "client",
	gitea: "client",
	github: "client",
	gitlab: "client",
	libsql: "checked",
	licenseKey: { allow: ["haveValidLicenseKey"] },
	mariadb: "checked",
	mongo: "checked",
	mounts: "checked",
	mysql: "checked",
	network: "checked",
	notification: "client",
	olympe: "client",
	organization: "checked",
	overview: "client",
	patch: {
		allow: [
			"create",
			"one",
			"byEntityId",
			"update",
			"delete",
			"toggleEnabled",
			"ensureRepo",
			"readRepoDirectories",
			"readRepoFile",
			"saveFileAsPatch",
			"markFileForDeletion",
		],
	},
	port: "checked",
	postgres: "checked",
	previewDeployment: "client",
	project: "client",
	projectExportImport: "client",
	redirects: "client",
	redis: "checked",
	registry: "client",
	rollback: "client",
	sandbox: "operator",
	schedule: "checked",
	scim: "operator",
	security: "client",
	server: "checked",
	serverSecurity: "operator",
	settings: {
		allow: [
			"getWebServerSettings",
			"getDokployVersion",
			"getReleaseTag",
			"getIp",
			"isCloud",
			"getPostHogConfig",
			"isUserSubscribed",
			"health",
			"getUpdateData",
		],
	},
	sshKey: "client",
	sso: "operator",
	stripe: "operator",
	swarm: "operator",
	tag: "client",
	telemetryProvider: "client",
	transfer: "operator",
	trash: "client",
	user: "checked",
	vaultProvider: "client",
	volumeBackups: "checked",
	whitelabeling: { allow: ["getPublic", "get"] },
};

const forbid = (message: string): never => {
	throw new TRPCError({ code: "FORBIDDEN", message });
};

const OPERATOR_ONLY =
	"Cette fonction est réservée à l'administrateur de la plateforme Olympe.";

type AnyInput = Record<string, any> | undefined;

const CREATE_PATHS: Record<string, CreatableResource> = {
	"application.create": "service",
	"compose.create": "service",
	"compose.deployTemplate": "service",
	"compose.import": "service",
	"postgres.create": "database",
	"mysql.create": "database",
	"mariadb.create": "database",
	"mongo.create": "database",
	"redis.create": "database",
	"libsql.create": "database",
	"domain.create": "domain",
	"organization.inviteMember": "member",
	"projectExportImport.import": "service",
};

// Procedures of "checked" routers that clients may never call.
const BLOCKED_PATHS = new Set([
	"application.readTraefikConfig",
	"application.updateTraefikConfig",
	"backup.defaultBackupStatus",
	"backup.backfillDefaultBackups",
	"backup.manualBackupWebServer",
	"network.networksToSync",
	"network.import",
	"network.resync",
	"organization.create",
	"server.getServerMetrics",
	"server.updateBuildsConcurrency",
	"user.getServerMetrics",
]);

// Mutations a suspended client can still make: paying, profile, leaving.
const ALLOWED_WHEN_SUSPENDED = new Set([
	"olympe",
	"user",
	"organization",
	"notification",
]);

const SERVICE_ID_FIELDS = [
	["applicationId", applications],
	["composeId", compose],
	["postgresId", postgres],
	["mysqlId", mysql],
	["mariadbId", mariadb],
	["mongoId", mongo],
	["redisId", redis],
	["libsqlId", libsql],
] as const;

const appNameOfServiceRef = async (input: AnyInput): Promise<string | null> => {
	for (const [field, table] of SERVICE_ID_FIELDS) {
		const id = input?.[field];
		if (typeof id !== "string" || !id) continue;
		const idColumn = (table as any)[field];
		const [row] = await db
			.select({ appName: table.appName })
			.from(table)
			.where(eq(idColumn, id))
			.limit(1);
		if (row) return row.appName;
	}
	return null;
};

const assertAppNameInOrganization = async (
	appName: string,
	organizationId: string,
) => {
	const owner = await findOrganizationIdByAppName(appName);
	if (owner !== organizationId)
		forbid("Ce service n'appartient pas à votre espace.");
};

const CONTAINER_LABELS = [
	"com.docker.swarm.service.name",
	"com.docker.compose.project",
	"com.docker.stack.namespace",
];

export const findOrganizationIdByContainer = async (
	containerId: string,
	serverId?: string | null,
) => {
	try {
		const docker = await getRemoteDocker(serverId);
		const info = await docker.getContainer(containerId).inspect();
		const labels = info.Config?.Labels ?? {};
		const candidates = new Set<string>();
		for (const key of CONTAINER_LABELS) {
			const value = labels[key];
			if (!value) continue;
			candidates.add(value);
			if (value.includes("_")) candidates.add(value.split("_")[0] ?? value);
		}
		for (const candidate of candidates) {
			const owner = await findOrganizationIdByAppName(candidate);
			if (owner) return owner;
		}
	} catch {
		return null;
	}
	return null;
};

const checkDocker = async (
	procedure: string,
	input: AnyInput,
	organizationId: string,
) => {
	if (typeof input?.appName === "string") {
		await assertAppNameInOrganization(input.appName, organizationId);
		return;
	}
	if (typeof input?.containerId === "string") {
		const owner = await findOrganizationIdByContainer(
			input.containerId,
			input.serverId,
		);
		if (owner !== organizationId)
			forbid("Ce conteneur n'appartient pas à votre espace.");
		return;
	}
	forbid(OPERATOR_ONLY);
	void procedure;
};

const checkDomain = async (input: AnyInput, organizationId: string) => {
	if (typeof input?.host !== "string") return;
	const problem = checkDomainHost(input.host, getOlympeConfig());
	if (problem) forbid(`Domaine refusé : ${problem}.`);
	const owners = await findDomainOwners(input.host);
	if (owners.some((owner) => owner !== organizationId)) {
		forbid("Domaine refusé : il est déjà utilisé par un autre espace Olympe.");
	}
};

const checkMountInput = (input: AnyInput) => {
	if (
		input?.type === "bind" ||
		(typeof input?.hostPath === "string" && input.hostPath)
	) {
		forbid(
			"Le montage d'un dossier du serveur est interdit sur Olympe. Utilisez un volume ou un fichier.",
		);
	}
};

const checkVolumeBackup = async (input: AnyInput) => {
	if (typeof input?.volumeName !== "string") return;
	let appName = await appNameOfServiceRef(input);
	if (!appName && typeof input?.volumeBackupId === "string") {
		const existing = await db.query.volumeBackups.findFirst({
			where: eq(volumeBackups.volumeBackupId, input.volumeBackupId),
		});
		appName = await appNameOfServiceRef(existing as AnyInput);
	}
	if (!appName || !isOwnVolumeName(input.volumeName, appName)) {
		forbid(`Le volume « ${input.volumeName} » n'appartient pas à ce service.`);
	}
};

const checkProcedure = async (
	path: string,
	input: AnyInput,
	organizationId: string,
) => {
	const [router = "", procedure = ""] = path.split(".");
	if (BLOCKED_PATHS.has(path)) forbid(OPERATOR_ONLY);

	if (
		procedure === "saveExternalPort" &&
		input?.externalPort &&
		!getOlympeConfig().allowPublishedPorts
	) {
		forbid(
			"L'accès externe direct aux bases de données est désactivé sur Olympe pour le moment.",
		);
	}

	if (typeof input?.previewWildcard === "string" && input.previewWildcard) {
		const zone = input.previewWildcard.replace(/^\*\./, "");
		const problem = checkDomainHost(`preview.${zone}`, getOlympeConfig());
		if (problem) forbid(`Domaine des previews refusé : ${problem}.`);
	}

	switch (router) {
		case "docker":
			return checkDocker(procedure, input, organizationId);
		case "domain":
			if (procedure === "create" || procedure === "update") {
				return checkDomain(input, organizationId);
			}
			return;
		case "mounts":
			if (procedure === "create" || procedure === "update")
				checkMountInput(input);
			return;
		case "port":
			if (
				(procedure === "create" || procedure === "update") &&
				!getOlympeConfig().allowPublishedPorts
			) {
				forbid(
					"Les ports publiés sur le serveur sont désactivés sur Olympe. Ajoutez un domaine pour exposer le service.",
				);
			}
			return;
		case "schedule":
			if (
				(procedure === "create" || procedure === "update") &&
				input?.scheduleType === "dokploy-server"
			) {
				forbid(
					"Les tâches planifiées sur le serveur Olympe sont réservées à l'administrateur.",
				);
			}
			return;
		case "network":
			if (
				procedure === "create" &&
				typeof input?.name === "string" &&
				/^(olympe-|dokploy)/i.test(input.name)
			) {
				forbid("Ce nom de réseau est réservé.");
			}
			return;
		case "server":
			if (procedure === "getServerMetrics" && !input?.serverId)
				forbid(OPERATOR_ONLY);
			return;
		case "user":
			if (
				procedure === "getContainerMetrics" &&
				typeof input?.appName === "string"
			) {
				await assertAppNameInOrganization(input.appName, organizationId);
			}
			return;
		case "volumeBackups":
			if (procedure === "create" || procedure === "update") {
				await checkVolumeBackup(input);
			}
			return;
		default:
			return;
	}
};

export const evaluateTenantRequest = async ({
	organizationId,
	path,
	type,
	input,
	user,
}: {
	organizationId: string | null | undefined;
	path: string;
	type: string;
	input: unknown;
	user?: { email?: string; emailVerified?: boolean } | null;
}) => {
	if (!organizationId || !isClientOrganization(organizationId)) return;

	const [router = "", procedure = ""] = path.split(".");
	const policy = ROUTER_POLICY[router];
	if (!policy || policy === "operator") forbid(OPERATOR_ONLY);
	if (typeof policy === "object" && !policy.allow.includes(procedure)) {
		forbid(OPERATOR_ONLY);
	}

	const data = (
		input && typeof input === "object" ? input : undefined
	) as AnyInput;
	if (policy === "checked") await checkProcedure(path, data, organizationId);

	if (type !== "mutation") return;

	if (
		getOlympeConfig().emailVerificationRequired &&
		user?.email &&
		user.emailVerified === false &&
		!ALLOWED_WHEN_SUSPENDED.has(router) &&
		(await hasSelfSignedUp(user.email))
	) {
		forbid(
			"Confirmez d'abord votre adresse e-mail grâce au lien que nous vous avons envoyé.",
		);
	}

	const tenant = await getTenant(organizationId);
	if (tenant.status === "suspended" && !ALLOWED_WHEN_SUSPENDED.has(router)) {
		forbid(
			"Votre espace est suspendu faute de paiement. Renouvelez votre forfait dans Facturation pour le réactiver.",
		);
	}

	const resource = CREATE_PATHS[path];
	if (resource) {
		const usage = await getOrganizationUsage(organizationId);
		assertWithinCreationLimit(tenant.plan, usage, resource);
	}
};
