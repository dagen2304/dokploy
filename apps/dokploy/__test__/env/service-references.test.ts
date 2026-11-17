import {
	buildDatabaseVariables,
	buildReferenceEdges,
	buildServiceVariables,
	hasServiceReferences,
	referenceNameFor,
	replaceServiceReferences,
	type ServiceRefTarget,
	slugifyServiceName,
} from "@dokploy/server/utils/service-refs/variables";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";

const postgres: ServiceRefTarget = {
	id: "pg1",
	type: "postgres",
	name: "Postgres",
	appName: "shop-postgres-a1b2c3",
	variables: buildDatabaseVariables("postgres", {
		appName: "shop-postgres-a1b2c3",
		databaseUser: "shop",
		databasePassword: "p@ss:w/rd",
		databaseName: "shop",
	}),
};

const api: ServiceRefTarget = {
	id: "app1",
	type: "application",
	name: "My API",
	appName: "shop-api-d4e5f6",
	variables: buildServiceVariables(
		"application",
		{
			appName: "shop-api-d4e5f6",
			env: "PORT=4000\nSECRET=abc",
			domains: [{ host: "api.apps.ktc-org.com", https: true, port: 4000 }],
		},
		(env) => parse(env ?? ""),
	),
};

const targets = [postgres, api];

describe("replaceServiceReferences", () => {
	it("resolves a database URL by service name, case-insensitively", () => {
		expect(
			replaceServiceReferences(
				"DATABASE_URL=${{Postgres.DATABASE_URL}}",
				targets,
			),
		).toBe(
			"DATABASE_URL=postgresql://shop:p%40ss%3Aw%2Frd@shop-postgres-a1b2c3:5432/shop",
		);
		expect(replaceServiceReferences("H=${{postgres.HOST}}", targets)).toBe(
			"H=shop-postgres-a1b2c3",
		);
	});

	it("resolves by slugified display name and by appName", () => {
		expect(replaceServiceReferences("U=${{my-api.PUBLIC_URL}}", targets)).toBe(
			"U=https://api.apps.ktc-org.com",
		);
		expect(
			replaceServiceReferences("S=${{shop-api-d4e5f6.SECRET}}", targets),
		).toBe("S=abc");
	});

	it("exposes the private hostname and keeps the app's own PORT", () => {
		expect(api.variables.PRIVATE_DOMAIN).toBe("shop-api-d4e5f6");
		expect(api.variables.PORT).toBe("4000");
	});

	it("leaves project, environment, vault and self references untouched", () => {
		const env = [
			"A=${{project.X}}",
			"B=${{environment.Y}}",
			"C=${{vault.main.Z}}",
			"D=${{A}}",
		].join("\n");
		expect(replaceServiceReferences(env, targets)).toBe(env);
		expect(hasServiceReferences(env)).toBe(false);
	});

	it("fails with a clear message for an unknown service or variable", () => {
		expect(() =>
			replaceServiceReferences("X=${{redis.REDIS_URL}}", targets),
		).toThrow(/Service "redis" not found/);
		expect(() =>
			replaceServiceReferences("X=${{postgres.NOPE}}", targets),
		).toThrow(/Variable "NOPE" not found on service "postgres"/);
	});

	it("refuses an ambiguous name and suggests the appName instead", () => {
		const twin: ServiceRefTarget = {
			...postgres,
			id: "pg2",
			appName: "other-postgres-zzz",
		};
		const both = [postgres, twin];
		expect(() =>
			replaceServiceReferences("X=${{postgres.HOST}}", both),
		).toThrow(/ambiguous/);
		expect(referenceNameFor(postgres, both)).toBe("shop-postgres-a1b2c3");
		expect(referenceNameFor(postgres, targets)).toBe("postgres");
	});
});

describe("buildDatabaseVariables", () => {
	it("builds connection URLs for every database type", () => {
		const base = { appName: "db", databasePassword: "pw", databaseUser: "u" };
		expect(
			buildDatabaseVariables("mysql", { ...base, databaseName: "d" })
				.DATABASE_URL,
		).toBe("mysql://u:pw@db:3306/d");
		expect(buildDatabaseVariables("redis", base).REDIS_URL).toBe(
			"redis://default:pw@db:6379",
		);
		expect(buildDatabaseVariables("mongo", base).MONGO_URL).toBe(
			"mongodb://u:pw@db:27017/?authSource=admin&directConnection=true",
		);
		expect(buildDatabaseVariables("libsql", base).DATABASE_URL).toBe(
			"http://u:pw@db:8080",
		);
	});
});

describe("slugifyServiceName", () => {
	it("normalises accents, spaces and case", () => {
		expect(slugifyServiceName("  Base de Données ")).toBe("base-de-donnees");
	});
});

describe("buildReferenceEdges", () => {
	it("draws one edge per referenced service with the variable names", () => {
		const worker: ServiceRefTarget = {
			id: "w1",
			type: "application",
			name: "Worker",
			appName: "shop-worker-111",
			variables: {},
			env: [
				"DATABASE_URL=${{postgres.DATABASE_URL}}",
				"PGHOST=${{postgres.PGHOST}}",
				"API=${{my-api.PUBLIC_URL}}",
				"REGION=${{project.REGION}}",
				"BROKEN=${{nope.X}}",
				"SELF=${{worker.PORT}}",
			].join("\n"),
		};
		expect(buildReferenceEdges([postgres, api, worker])).toEqual([
			{ source: "w1", target: "pg1", keys: ["DATABASE_URL", "PGHOST"] },
			{ source: "w1", target: "app1", keys: ["PUBLIC_URL"] },
		]);
	});
});
