import path from "node:path";
import type { OlympeConfig } from "./config";

// Pure checks run for client organizations only. Each returns the list of
// problems in French so the deploy log and the API error read the same.

type AnyRecord = Record<string, any>;

const isRecord = (value: unknown): value is AnyRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const isContainedRelativePath = (value: string) => {
	const trimmed = value.trim();
	if (!trimmed) return true;
	if (trimmed.startsWith("/") || trimmed.startsWith("~")) return false;
	if (/^[a-zA-Z]:[\\/]/.test(trimmed)) return false;
	const normalized = path.posix.normalize(trimmed.replace(/\\/g, "/"));
	return normalized !== ".." && !normalized.startsWith("../");
};

const isRemoteBuildContext = (value: string) =>
	/^(https?:\/\/|git@|git:\/\/|github\.com\/)/i.test(value.trim());

const labelKeys = (labels: unknown): string[] => {
	if (Array.isArray(labels)) {
		return labels.map((label) => String(label).split("=")[0]?.trim() ?? "");
	}
	if (isRecord(labels)) return Object.keys(labels);
	return [];
};

const hasTraefikLabel = (labels: unknown) =>
	labelKeys(labels).some((key) => key.toLowerCase().startsWith("traefik."));

const isHostNamespace = (value: unknown) =>
	typeof value === "string" &&
	(value === "host" || value.startsWith("container:"));

const bindSourceOf = (volume: unknown): string | null => {
	if (typeof volume === "string") {
		const [source, target] = volume.split(":");
		if (!target) return null;
		const s = source?.trim() ?? "";
		if (s.startsWith("/") || s.startsWith(".") || s.startsWith("~")) return s;
		return null;
	}
	if (isRecord(volume) && volume.type === "bind") {
		return String(volume.source ?? "");
	}
	return null;
};

const envFilePaths = (envFile: unknown): string[] => {
	if (typeof envFile === "string") return [envFile];
	if (Array.isArray(envFile)) {
		return envFile.map((entry) =>
			isRecord(entry) ? String(entry.path ?? "") : String(entry),
		);
	}
	return [];
};

export const checkComposeSpec = (
	spec: unknown,
	options: { allowPublishedPorts: boolean },
): string[] => {
	const problems: string[] = [];
	if (!isRecord(spec)) return problems;

	if (spec.include !== undefined) {
		const entries = Array.isArray(spec.include) ? spec.include : [spec.include];
		for (const entry of entries) {
			const paths = isRecord(entry)
				? [entry.path, entry.env_file, entry.project_directory].flat()
				: [entry];
			for (const p of paths) {
				if (typeof p === "string" && !isContainedRelativePath(p)) {
					problems.push(`include : le chemin « ${p} » sort du projet`);
				}
			}
		}
	}

	for (const [name, network] of Object.entries(spec.networks ?? {})) {
		if (isRecord(network) && (network.external || network.name)) {
			problems.push(
				`réseau « ${name} » : les réseaux externes ou renommés ne sont pas autorisés`,
			);
		}
	}

	for (const [name, volume] of Object.entries(spec.volumes ?? {})) {
		if (
			isRecord(volume) &&
			(volume.external || volume.name || volume.driver || volume.driver_opts)
		) {
			problems.push(
				`volume « ${name} » : external, name, driver et driver_opts ne sont pas autorisés`,
			);
		}
	}

	for (const kind of ["configs", "secrets"] as const) {
		for (const [name, entry] of Object.entries(spec[kind] ?? {})) {
			if (!isRecord(entry)) continue;
			if (entry.external) {
				problems.push(`${kind} « ${name} » : external n'est pas autorisé`);
			}
			if (
				typeof entry.file === "string" &&
				!isContainedRelativePath(entry.file)
			) {
				problems.push(
					`${kind} « ${name} » : le fichier « ${entry.file} » sort du projet`,
				);
			}
		}
	}

	for (const [name, service] of Object.entries(spec.services ?? {})) {
		if (!isRecord(service)) continue;
		const where = `service « ${name} »`;

		if (service.privileged) problems.push(`${where} : privileged est interdit`);
		for (const key of [
			"cap_add",
			"devices",
			"device_cgroup_rules",
			"security_opt",
			"cgroup_parent",
		]) {
			const value = service[key];
			if (
				value !== undefined &&
				value !== null &&
				value !== "" &&
				!(Array.isArray(value) && value.length === 0)
			) {
				problems.push(`${where} : ${key} est interdit`);
			}
		}
		if (service.oom_kill_disable) {
			problems.push(`${where} : oom_kill_disable est interdit`);
		}
		for (const key of ["pid", "ipc", "uts", "userns_mode", "cgroup"]) {
			if (isHostNamespace(service[key])) {
				problems.push(`${where} : ${key}: ${service[key]} est interdit`);
			}
		}
		if (
			typeof service.network_mode === "string" &&
			service.network_mode !== "none" &&
			!service.network_mode.startsWith("service:")
		) {
			problems.push(
				`${where} : network_mode: ${service.network_mode} est interdit`,
			);
		}
		for (const volume of service.volumes ?? []) {
			const source = bindSourceOf(volume);
			if (source !== null) {
				problems.push(
					`${where} : le montage du dossier « ${source} » du serveur est interdit, utilisez un volume nommé`,
				);
			}
		}
		for (const entry of service.volumes_from ?? []) {
			if (String(entry).startsWith("container:")) {
				problems.push(`${where} : volumes_from vers un conteneur est interdit`);
			}
		}
		if (
			!options.allowPublishedPorts &&
			Array.isArray(service.ports) &&
			service.ports.length > 0
		) {
			problems.push(
				`${where} : les ports publiés sur le serveur sont interdits, ajoutez un domaine pour exposer le service`,
			);
		}
		if (
			hasTraefikLabel(service.labels) ||
			hasTraefikLabel(service.deploy?.labels)
		) {
			problems.push(
				`${where} : les labels traefik.* sont gérés par Olympe, configurez un domaine à la place`,
			);
		}
		for (const file of envFilePaths(service.env_file)) {
			if (!isContainedRelativePath(file)) {
				problems.push(`${where} : env_file « ${file} » sort du projet`);
			}
		}
		const build = service.build;
		const contexts: string[] = [];
		if (typeof build === "string") contexts.push(build);
		if (isRecord(build)) {
			if (typeof build.context === "string") contexts.push(build.context);
			if (typeof build.dockerfile === "string") contexts.push(build.dockerfile);
			if (isRecord(build.additional_contexts)) {
				contexts.push(...Object.values(build.additional_contexts).map(String));
			}
		}
		for (const context of contexts) {
			if (!isRemoteBuildContext(context) && !isContainedRelativePath(context)) {
				problems.push(`${where} : le build « ${context} » sort du projet`);
			}
		}
		if (
			isRecord(service.extends) &&
			typeof service.extends.file === "string" &&
			!isContainedRelativePath(service.extends.file)
		) {
			problems.push(
				`${where} : extends « ${service.extends.file} » sort du projet`,
			);
		}
	}

	return problems;
};

type MountLike = {
	type: string;
	hostPath?: string | null;
	volumeName?: string | null;
};

export const checkMounts = (mounts: MountLike[], appName: string): string[] => {
	const problems: string[] = [];
	for (const mount of mounts) {
		if (mount.type === "bind") {
			problems.push(
				`le montage du dossier « ${mount.hostPath ?? ""} » du serveur est interdit, utilisez un volume`,
			);
		}
		if (
			mount.type === "volume" &&
			!isOwnVolumeName(mount.volumeName, appName)
		) {
			problems.push(
				`le volume « ${mount.volumeName ?? ""} » doit commencer par « ${appName} »`,
			);
		}
	}
	return problems;
};

export const isOwnVolumeName = (
	volumeName: string | null | undefined,
	appName: string,
) =>
	Boolean(volumeName) &&
	(volumeName === appName ||
		volumeName!.startsWith(`${appName}-`) ||
		volumeName!.startsWith(`${appName}_`));

type SwarmLike = {
	labelsSwarm?: Record<string, string> | null;
	endpointSpecSwarm?: { Ports?: unknown[] | null } | null;
	ports?: unknown[] | null;
	externalPort?: number | null;
};

export const checkSwarmSettings = (
	service: SwarmLike,
	options: { allowPublishedPorts: boolean },
): string[] => {
	const problems: string[] = [];
	if (hasTraefikLabel(service.labelsSwarm)) {
		problems.push(
			"les labels traefik.* sont gérés par Olympe, configurez un domaine à la place",
		);
	}
	if (!options.allowPublishedPorts) {
		const published =
			(service.ports?.length ?? 0) +
			(service.endpointSpecSwarm?.Ports?.length ?? 0) +
			(service.externalPort ? 1 : 0);
		if (published > 0) {
			problems.push(
				"les ports publiés sur le serveur sont interdits, ajoutez un domaine pour exposer le service",
			);
		}
	}
	return problems;
};

export const checkBuildPaths = (
	fields: Record<string, string | null | undefined>,
): string[] =>
	Object.entries(fields)
		.filter(
			([, value]) =>
				typeof value === "string" && !isContainedRelativePath(value),
		)
		.map(([field, value]) => `${field} « ${value} » sort du dossier du projet`);

export const BUILD_PATH_FIELDS = [
	"buildPath",
	"gitlabBuildPath",
	"bitbucketBuildPath",
	"giteaBuildPath",
	"dropBuildPath",
	"customGitBuildPath",
	"dockerfile",
	"dockerContextPath",
	"composePath",
] as const;

export const pickBuildPaths = (service: Record<string, unknown>) =>
	Object.fromEntries(
		BUILD_PATH_FIELDS.filter((field) => typeof service[field] === "string").map(
			(field) => [field, service[field] as string],
		),
	);

export const normalizeHost = (host: string) =>
	host.trim().toLowerCase().replace(/\.$/, "");

const isUnder = (host: string, zone: string) =>
	host === zone || host.endsWith(`.${zone}`);

export const checkDomainHost = (
	rawHost: string,
	config: Pick<
		OlympeConfig,
		"tenantAppsDomain" | "protectedDomains" | "reservedSubdomains"
	>,
): string | null => {
	const host = normalizeHost(rawHost);
	if (!host) return "nom de domaine vide";
	const tenantZone = config.tenantAppsDomain;
	if (tenantZone && host.endsWith(`.${tenantZone}`)) {
		const label = host.slice(0, -(tenantZone.length + 1));
		if (label.includes(".")) {
			return `utilisez un seul niveau sous ${tenantZone}, par exemple monapp.${tenantZone}`;
		}
		if (config.reservedSubdomains.includes(label)) {
			return `« ${label} » est un nom réservé, choisissez-en un autre`;
		}
		return null;
	}
	if (config.protectedDomains.some((zone) => isUnder(host, zone))) {
		return tenantZone
			? `ce domaine est réservé ; utilisez un sous-domaine de ${tenantZone} ou votre propre domaine`
			: "ce domaine est réservé ; utilisez votre propre domaine";
	}
	return null;
};
