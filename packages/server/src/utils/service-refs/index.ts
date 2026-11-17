import { db } from "@dokploy/server/db";
import { environments } from "@dokploy/server/db/schema";
import { parse } from "dotenv";
import { eq } from "drizzle-orm";
import { prepareEnvironmentVariables } from "../docker/utils";
import {
	buildDatabaseVariables,
	buildServiceVariables,
	hasServiceReferences,
	replaceServiceReferences,
	type ServiceRefTarget,
} from "./variables";

export * from "./variables";

const domainColumns = { host: true, https: true, port: true } as const;

export const loadServiceRefTargets = async (
	environmentId: string,
): Promise<ServiceRefTarget[]> => {
	const environment = await db.query.environments.findFirst({
		where: eq(environments.environmentId, environmentId),
		columns: { env: true },
		with: {
			project: { columns: { env: true } },
			applications: {
				columns: { applicationId: true, name: true, appName: true, env: true },
				with: { domains: { columns: domainColumns } },
			},
			compose: {
				columns: { composeId: true, name: true, appName: true, env: true },
				with: { domains: { columns: domainColumns } },
			},
			postgres: true,
			mysql: true,
			mariadb: true,
			mongo: true,
			redis: true,
			libsql: true,
		},
	});
	if (!environment) return [];

	// Referenced services' own values may use ${{project.X}} / ${{environment.X}};
	// resolve those, but fall back to raw values rather than failing the deploy
	// of the service that references them.
	const resolveOwnEnv = (env: string | null) => {
		try {
			return Object.fromEntries(
				prepareEnvironmentVariables(
					env,
					environment.project.env,
					environment.env,
				).map((line) => {
					const index = line.indexOf("=");
					return [line.slice(0, index), line.slice(index + 1)];
				}),
			);
		} catch {
			return parse(env ?? "");
		}
	};

	return [
		...environment.applications.map((app) => ({
			id: app.applicationId,
			type: "application" as const,
			name: app.name,
			appName: app.appName,
			variables: buildServiceVariables("application", app, resolveOwnEnv),
			env: app.env,
		})),
		...environment.compose.map((compose) => ({
			id: compose.composeId,
			type: "compose" as const,
			name: compose.name,
			appName: compose.appName,
			variables: buildServiceVariables("compose", compose, resolveOwnEnv),
			env: compose.env,
		})),
		...environment.postgres.map((row) => ({
			id: row.postgresId,
			type: "postgres" as const,
			name: row.name,
			appName: row.appName,
			variables: buildDatabaseVariables("postgres", row),
			env: row.env,
		})),
		...environment.mysql.map((row) => ({
			id: row.mysqlId,
			type: "mysql" as const,
			name: row.name,
			appName: row.appName,
			variables: buildDatabaseVariables("mysql", row),
			env: row.env,
		})),
		...environment.mariadb.map((row) => ({
			id: row.mariadbId,
			type: "mariadb" as const,
			name: row.name,
			appName: row.appName,
			variables: buildDatabaseVariables("mariadb", row),
			env: row.env,
		})),
		...environment.mongo.map((row) => ({
			id: row.mongoId,
			type: "mongo" as const,
			name: row.name,
			appName: row.appName,
			variables: buildDatabaseVariables("mongo", row),
			env: row.env,
		})),
		...environment.redis.map((row) => ({
			id: row.redisId,
			type: "redis" as const,
			name: row.name,
			appName: row.appName,
			variables: buildDatabaseVariables("redis", row),
			env: row.env,
		})),
		...environment.libsql.map((row) => ({
			id: row.libsqlId,
			type: "libsql" as const,
			name: row.name,
			appName: row.appName,
			variables: buildDatabaseVariables("libsql", row),
			env: row.env,
		})),
	];
};

type EnvBearingEntity = {
	env: string | null;
	buildArgs?: string | null;
	buildSecrets?: string | null;
	environment: { environmentId: string };
};

export const withResolvedServiceRefs = async <T extends EnvBearingEntity>(
	entity: T,
): Promise<T> => {
	const fields = [entity.env, entity.buildArgs, entity.buildSecrets];
	if (!fields.some(hasServiceReferences)) return entity;

	const targets = await loadServiceRefTargets(entity.environment.environmentId);
	const resolved: T = {
		...entity,
		env: replaceServiceReferences(entity.env, targets),
	};
	if (entity.buildArgs !== undefined) {
		resolved.buildArgs = replaceServiceReferences(
			entity.buildArgs ?? null,
			targets,
		);
	}
	if (entity.buildSecrets !== undefined) {
		resolved.buildSecrets = replaceServiceReferences(
			entity.buildSecrets ?? null,
			targets,
		);
	}
	return resolved;
};
