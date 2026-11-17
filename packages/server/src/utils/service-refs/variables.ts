import { parse } from "dotenv";

// Group 1 is the service, group 2 the variable. Names that already have a
// meaning in Dokploy (project, environment, vault) are excluded below.
export const SERVICE_REF_REGEX =
	/\$\{\{([A-Za-z0-9][A-Za-z0-9_-]*)\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

const RESERVED_NAMESPACES = new Set(["project", "environment", "vault"]);

export type ServiceRefType =
	| "application"
	| "compose"
	| "postgres"
	| "mysql"
	| "mariadb"
	| "mongo"
	| "redis"
	| "libsql";

export type ServiceRefTarget = {
	id: string;
	type: ServiceRefType;
	name: string;
	appName: string;
	variables: Record<string, string>;
};

export const slugifyServiceName = (name: string) =>
	name
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

export const isReservedNamespace = (name: string) =>
	RESERVED_NAMESPACES.has(name.toLowerCase());

export const hasServiceReferences = (rawEnv: string | null | undefined) =>
	!!rawEnv &&
	[...rawEnv.matchAll(SERVICE_REF_REGEX)].some(
		(match) => !isReservedNamespace(match[1] as string),
	);

/**
 * The name to suggest in `${{<name>.VAR}}`: the slugified display name,
 * unless another service in the environment has the same slug, in which
 * case only the unique appName is unambiguous.
 */
export const referenceNameFor = (
	target: ServiceRefTarget,
	targets: ServiceRefTarget[],
) => {
	const slug = slugifyServiceName(target.name);
	const clash = targets.some(
		(other) =>
			other.id !== target.id && slugifyServiceName(other.name) === slug,
	);
	return slug && !clash && !isReservedNamespace(slug) ? slug : target.appName;
};

export const findServiceRefTarget = (
	ref: string,
	targets: ServiceRefTarget[],
) => {
	const byAppName = targets.find((target) => target.appName === ref);
	if (byAppName) return byAppName;

	const slug = slugifyServiceName(ref);
	const bySlug = targets.filter(
		(target) => slugifyServiceName(target.name) === slug,
	);
	if (bySlug.length > 1) {
		throw new Error(
			`Service reference "${ref}" is ambiguous: ${bySlug.length} services share this name. Use the service's app name instead (${bySlug.map((t) => t.appName).join(", ")}).`,
		);
	}
	return bySlug[0];
};

export const replaceServiceReferences = (
	rawEnv: string | null,
	targets: ServiceRefTarget[],
): string | null => {
	if (!rawEnv) return rawEnv;

	return rawEnv.replace(
		SERVICE_REF_REGEX,
		(match, ref: string, key: string) => {
			if (isReservedNamespace(ref)) return match;

			const target = findServiceRefTarget(ref, targets);
			if (!target) {
				throw new Error(
					`Service "${ref}" not found in this environment (used in \${{${ref}.${key}}}).`,
				);
			}
			const value = target.variables[key];
			if (value === undefined) {
				const available = Object.keys(target.variables).sort().join(", ");
				throw new Error(
					`Variable "${key}" not found on service "${ref}". Available: ${available}.`,
				);
			}
			return value;
		},
	);
};

const userInfo = (user: string, password: string) =>
	`${encodeURIComponent(user)}:${encodeURIComponent(password)}`;

type DatabaseRow = {
	appName: string;
	databasePassword: string;
	databaseUser?: string;
	databaseName?: string;
	databaseRootPassword?: string;
	replicaSets?: boolean | null;
	env?: string | null;
};

export const buildDatabaseVariables = (
	type: Exclude<ServiceRefType, "application" | "compose">,
	row: DatabaseRow,
): Record<string, string> => {
	const host = row.appName;
	const password = row.databasePassword;
	const user = row.databaseUser ?? "default";
	const own = parse(row.env ?? "");

	switch (type) {
		case "postgres": {
			const database = row.databaseName ?? "";
			const url = `postgresql://${userInfo(user, password)}@${host}:5432/${database}`;
			return {
				...own,
				HOST: host,
				PORT: "5432",
				USER: user,
				PASSWORD: password,
				DATABASE: database,
				DATABASE_URL: url,
				PGHOST: host,
				PGPORT: "5432",
				PGUSER: user,
				PGPASSWORD: password,
				PGDATABASE: database,
			};
		}
		case "mysql":
		case "mariadb": {
			const database = row.databaseName ?? "";
			// mysql:// is understood by MariaDB clients too (Prisma, Drizzle, etc.).
			const url = `mysql://${userInfo(user, password)}@${host}:3306/${database}`;
			return {
				...own,
				HOST: host,
				PORT: "3306",
				USER: user,
				PASSWORD: password,
				DATABASE: database,
				ROOT_PASSWORD: row.databaseRootPassword ?? "",
				DATABASE_URL: url,
			};
		}
		case "mongo": {
			const query = `authSource=admin${row.replicaSets ? "" : "&directConnection=true"}`;
			const url = `mongodb://${userInfo(user, password)}@${host}:27017/?${query}`;
			return {
				...own,
				HOST: host,
				PORT: "27017",
				USER: user,
				PASSWORD: password,
				DATABASE_URL: url,
				MONGO_URL: url,
			};
		}
		case "redis": {
			const url = `redis://${userInfo("default", password)}@${host}:6379`;
			return {
				...own,
				HOST: host,
				PORT: "6379",
				USER: "default",
				PASSWORD: password,
				DATABASE_URL: url,
				REDIS_URL: url,
			};
		}
		case "libsql": {
			const url = `http://${userInfo(user, password)}@${host}:8080`;
			return {
				...own,
				HOST: host,
				PORT: "8080",
				USER: user,
				PASSWORD: password,
				DATABASE_URL: url,
			};
		}
	}
};

type DomainRow = {
	host: string;
	https: boolean;
	port: number | null;
};

export const buildServiceVariables = (
	type: "application" | "compose",
	row: { appName: string; env: string | null; domains: DomainRow[] },
	resolveOwnEnv: (env: string | null) => Record<string, string>,
): Record<string, string> => {
	const variables: Record<string, string> = { ...resolveOwnEnv(row.env) };

	if (type === "application") {
		variables.PRIVATE_DOMAIN = row.appName;
		variables.HOST ??= row.appName;
	}

	const domain = row.domains.find((d) => d.host);
	if (domain) {
		variables.PUBLIC_DOMAIN = domain.host;
		variables.PUBLIC_URL = `${domain.https ? "https" : "http"}://${domain.host}`;
		if (type === "application" && domain.port) {
			variables.PORT ??= String(domain.port);
		}
	}

	return variables;
};
