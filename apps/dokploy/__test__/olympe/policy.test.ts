import { getOlympeConfig } from "@dokploy/server/services/olympe/config";
import {
	checkBuildPaths,
	checkComposeSpec,
	checkDomainHost,
	checkMounts,
	checkSwarmSettings,
	isContainedRelativePath,
} from "@dokploy/server/services/olympe/policy";
import { describe, expect, it } from "vitest";

const strict = { allowPublishedPorts: false };

describe("isContainedRelativePath", () => {
	it.each([
		["", true],
		["Dockerfile", true],
		["apps/web", true],
		["./apps/../web", true],
		["..", false],
		["../../etc", false],
		["apps/../../x", false],
		["/etc/passwd", false],
		["~/.ssh", false],
		["C:\\\\Windows", false],
	])("%s → %s", (value, expected) => {
		expect(isContainedRelativePath(value)).toBe(expected);
	});
});

describe("checkComposeSpec", () => {
	it("accepts an ordinary compose", () => {
		const spec = {
			services: {
				web: {
					image: "nginx",
					volumes: [
						"data:/usr/share/nginx/html",
						{ type: "volume", source: "cache", target: "/c" },
					],
					environment: { A: "1" },
					build: { context: "./web", dockerfile: "Dockerfile" },
					env_file: [".env"],
					networks: ["default"],
				},
				db: { image: "postgres:16", network_mode: "service:web" },
			},
			volumes: { data: {}, cache: null },
		};
		expect(checkComposeSpec(spec, strict)).toEqual([]);
	});

	it("refuses everything that reaches the host or other clients", () => {
		const spec = {
			include: ["/etc/compose.yml"],
			networks: { shared: { external: true, name: "dokploy-network" } },
			volumes: {
				stolen: { external: true },
				raw: { driver_opts: { type: "none", o: "bind", device: "/" } },
			},
			secrets: { key: { file: "/root/.ssh/id_rsa" } },
			services: {
				evil: {
					image: "alpine",
					privileged: true,
					cap_add: ["SYS_ADMIN"],
					pid: "host",
					network_mode: "host",
					devices: ["/dev/sda"],
					volumes: [
						"/var/run/docker.sock:/var/run/docker.sock",
						"./:/app",
						{ type: "bind", source: "/", target: "/host" },
					],
					volumes_from: ["container:dokploy"],
					ports: ["5432:5432"],
					labels: {
						"traefik.http.routers.x.rule": "Host(`panel.ktc-org.com`)",
					},
					deploy: { labels: ["traefik.enable=true"] },
					env_file: "/etc/dokploy/.env",
					build: { context: "../../" },
					extends: { file: "/tmp/base.yml", service: "x" },
				},
			},
		};
		const problems = checkComposeSpec(spec, strict).join("\n");
		for (const expected of [
			"include",
			"réseau « shared »",
			"volume « stolen »",
			"volume « raw »",
			"secrets « key »",
			"privileged",
			"cap_add",
			"pid: host",
			"network_mode: host",
			"devices",
			"/var/run/docker.sock",
			"« ./ »",
			"« / »",
			"volumes_from",
			"ports publiés",
			"traefik",
			"env_file",
			"build « ../../ »",
			"extends",
		]) {
			expect(problems).toContain(expected);
		}
	});

	it("lets published ports through when the operator allows them", () => {
		const spec = { services: { web: { image: "nginx", ports: ["8080:80"] } } };
		expect(checkComposeSpec(spec, { allowPublishedPorts: true })).toEqual([]);
	});

	it("accepts remote git build contexts", () => {
		const spec = {
			services: { web: { build: "https://github.com/acme/app.git#main" } },
		};
		expect(checkComposeSpec(spec, strict)).toEqual([]);
	});
});

describe("service checks", () => {
	it("refuses bind mounts and volumes named after another service", () => {
		const problems = checkMounts(
			[
				{ type: "bind", hostPath: "/var/run/docker.sock" },
				{ type: "volume", volumeName: "other-app-data" },
				{ type: "volume", volumeName: "myapp-x1y2-data" },
				{ type: "file" },
			],
			"myapp-x1y2",
		);
		expect(problems).toHaveLength(2);
		expect(problems[0]).toContain("/var/run/docker.sock");
		expect(problems[1]).toContain("other-app-data");
	});

	it("refuses traefik labels and published ports on swarm services", () => {
		expect(
			checkSwarmSettings(
				{
					labelsSwarm: { "traefik.http.routers.a.rule": "Host(`x`)" },
					ports: [{}],
					externalPort: 5432,
				},
				strict,
			),
		).toHaveLength(2);
		expect(checkSwarmSettings({ labelsSwarm: { team: "a" } }, strict)).toEqual(
			[],
		);
	});

	it("refuses build paths that leave the project", () => {
		expect(
			checkBuildPaths({
				dockerContextPath: "../../../",
				dockerfile: "Dockerfile",
				buildPath: "/",
			}),
		).toHaveLength(2);
	});
});

describe("checkDomainHost", () => {
	const config = getOlympeConfig({
		OLYMPE_OPERATOR_ORG_ID: "op",
		APPS_WILDCARD_DOMAIN: "apps.ktc-org.com",
		OLYMPE_TENANT_APPS_DOMAIN: "*.up.ktc-org.com",
	});

	it("protects the operator's zone by default", () => {
		expect(config.protectedDomains).toEqual(["ktc-org.com"]);
		expect(config.tenantAppsDomain).toBe("up.ktc-org.com");
	});

	it.each([
		["monapp.up.ktc-org.com", null],
		["MonApp.Up.Ktc-Org.com.", null],
		["shop.client.cm", null],
		["a.b.up.ktc-org.com", "un seul niveau"],
		["panel.up.ktc-org.com", "nom réservé"],
		["up.ktc-org.com", "réservé"],
		["panel.ktc-org.com", "réservé"],
		["x.apps.ktc-org.com", "réservé"],
		["ktc-org.com", "réservé"],
	])("%s", (host, expected) => {
		const result = checkDomainHost(host, config);
		if (expected === null) expect(result).toBeNull();
		else expect(result).toContain(expected);
	});
});

describe("getOlympeConfig", () => {
	it("stays single-tenant without an operator organization", () => {
		const config = getOlympeConfig({ OLYMPE_PUBLIC_SIGNUP: "true" });
		expect(config.multiTenant).toBe(false);
		expect(config.publicSignup).toBe(false);
	});

	it("reads every setting from the environment", () => {
		const config = getOlympeConfig({
			OLYMPE_OPERATOR_ORG_ID: "op",
			OLYMPE_PUBLIC_SIGNUP: "yes",
			OLYMPE_GRACE_DAYS: "5",
			OLYMPE_REMINDER_DAYS: "1, 10,3",
			OLYMPE_PROTECTED_DOMAINS: "a.com,B.org",
			OLYMPE_TENANT_ALLOW_PUBLISHED_PORTS: "1",
		});
		expect(config.publicSignup).toBe(true);
		expect(config.graceDays).toBe(5);
		expect(config.reminderDays).toEqual([10, 3, 1]);
		expect(config.protectedDomains).toEqual(["a.com", "b.org"]);
		expect(config.allowPublishedPorts).toBe(true);
	});

	it("turns e-mail features on with SMTP only", () => {
		expect(getOlympeConfig({}).emailConfigured).toBe(false);
		const config = getOlympeConfig({ SMTP_SERVER: "smtp.resend.com" });
		expect(config.emailConfigured).toBe(true);
		expect(config.emailVerificationRequired).toBe(true);
	});
});
