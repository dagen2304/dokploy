import { checkServerChoice } from "@dokploy/server/services/olympe/guard";
import { isTenantServerOf } from "@dokploy/server/services/olympe/placement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const saved = { ...process.env };

beforeEach(() => {
	process.env.OLYMPE_OPERATOR_ORG_ID = "op";
	process.env.OLYMPE_TENANT_SERVER_ID = "vps2";
});

afterEach(() => {
	process.env = { ...saved };
});

describe("isTenantServerOf", () => {
	it("is true only for a client and the tenant server", () => {
		expect(isTenantServerOf("client", "vps2")).toBe(true);
		expect(isTenantServerOf("op", "vps2")).toBe(false);
		expect(isTenantServerOf("client", "other")).toBe(false);
		expect(isTenantServerOf("client", null)).toBe(false);
	});

	it("is off without a tenant server or outside multi-tenant mode", () => {
		delete process.env.OLYMPE_TENANT_SERVER_ID;
		expect(isTenantServerOf("client", "vps2")).toBe(false);
		process.env.OLYMPE_TENANT_SERVER_ID = "vps2";
		delete process.env.OLYMPE_OPERATOR_ORG_ID;
		expect(isTenantServerOf("client", "vps2")).toBe(false);
	});
});

describe("checkServerChoice", () => {
	const allowed = (path: string, input: Record<string, unknown>) => {
		try {
			checkServerChoice(path, input, "client");
			return true;
		} catch {
			return false;
		}
	};

	it("lets a client's own service pages name the tenant server", () => {
		expect(
			allowed("docker.getContainersByAppNameMatch", {
				appName: "a",
				serverId: "vps2",
			}),
		).toBe(true);
		expect(
			allowed("domain.validateDomain", { domain: "x", serverId: "vps2" }),
		).toBe(true);
		expect(allowed("backup.listBackupFiles", { serverId: "vps2" })).toBe(true);
	});

	it("refuses any other server, or the tenant server elsewhere", () => {
		expect(allowed("docker.getContainers", { serverId: "vps1" })).toBe(false);
		expect(allowed("registry.testRegistry", { serverId: "vps2" })).toBe(false);
		expect(allowed("destination.testConnection", { serverId: "vps2" })).toBe(
			false,
		);
		expect(allowed("application.create", { serverId: "vps2" })).toBe(false);
	});

	it("refuses a build server and server-wide deployment logs", () => {
		expect(allowed("application.update", { buildServerId: "vps2" })).toBe(
			false,
		);
		expect(
			allowed("deployment.allByType", { type: "server", id: "vps2" }),
		).toBe(false);
	});

	it("ignores empty values and the serverId volume backups send by mistake", () => {
		expect(allowed("application.create", { serverId: "" })).toBe(true);
		expect(allowed("compose.create", { serverId: "none" })).toBe(true);
		expect(
			allowed("volumeBackups.create", { serverId: "pg-1", postgresId: "pg-1" }),
		).toBe(true);
	});
});
