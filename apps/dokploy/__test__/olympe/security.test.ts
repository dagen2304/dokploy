import { hardenComposeServices } from "@dokploy/server/services/olympe/enforce";
import { DATABASE_USER_PATTERN } from "@dokploy/server/services/olympe/guard";
import {
	checkOutboundInput,
	checkOutboundTarget,
	collectOutboundTargets,
	isPrivateAddress,
	type Resolver,
} from "@dokploy/server/services/olympe/outbound";
import { clientIpFrom } from "@dokploy/server/services/olympe/signup";
import { redactServerSettingsForClient } from "@dokploy/server/services/olympe/tenancy";
import { withSecureTraefikApi } from "@dokploy/server/services/olympe/traefik";
import { describe, expect, it } from "vitest";

const publicDns: Resolver = async () => ["93.184.216.34"];
const internalDns: Resolver = async () => ["93.184.216.34", "10.0.1.5"];
const failingDns: Resolver = async () => {
	throw new Error("ENOTFOUND");
};

describe("isPrivateAddress", () => {
	it.each([
		"127.0.0.1",
		"10.1.2.3",
		"172.18.0.4",
		"192.168.1.10",
		"169.254.169.254",
		"100.64.0.1",
		"0.0.0.0",
		"::1",
		"fd00::1",
		"fe80::1",
		"::ffff:127.0.0.1",
	])("refuses %s", (address) => {
		expect(isPrivateAddress(address)).toBe(true);
	});

	it.each(["93.184.216.34", "45.81.7.27", "2606:4700::1111"])(
		"accepts %s",
		(address) => {
			expect(isPrivateAddress(address)).toBe(false);
		},
	);
});

describe("checkOutboundTarget", () => {
	it("accepts a public webhook", async () => {
		expect(
			await checkOutboundTarget(
				"https://discord.com/api/webhooks/1/x",
				publicDns,
			),
		).toBeNull();
	});

	it("accepts a registry host without a scheme", async () => {
		expect(await checkOutboundTarget("ghcr.io", publicDns)).toBeNull();
	});

	it("ignores empty values", async () => {
		expect(await checkOutboundTarget("", failingDns)).toBeNull();
	});

	it.each([
		"http://dokploy-traefik:8080/api/rawdata",
		"http://localhost:3000",
		"dokploy-postgres:5432",
		"http://minio.internal",
		"http://printer.local",
	])("refuses the internal name %s", async (target) => {
		expect(await checkOutboundTarget(target, publicDns)).not.toBeNull();
	});

	it.each([
		"http://127.0.0.1:4500/metrics",
		"http://169.254.169.254/latest/meta-data",
		"http://2130706433/",
		"http://0x7f000001/",
		"http://[::ffff:127.0.0.1]/",
		"http://172.17.0.1:22",
	])("refuses the internal address %s", async (target) => {
		expect(await checkOutboundTarget(target, publicDns)).not.toBeNull();
	});

	it("refuses a public name that resolves to an internal address", async () => {
		expect(
			await checkOutboundTarget("https://evil.example.com", internalDns),
		).toContain("adresse interne");
	});

	it("refuses a name that does not resolve", async () => {
		expect(
			await checkOutboundTarget("https://nowhere.example", failingDns),
		).toContain("introuvable");
	});
});

describe("collectOutboundTargets", () => {
	it("finds URL-like fields, including nested ones, but not ids", () => {
		expect(
			collectOutboundTargets({
				notificationId: "n1",
				serverId: "s1",
				webhookUrl: "https://a.example",
				smtpServer: "smtp.example.com",
				toAddresses: ["x@example.com"],
				config: { endpoint: "https://b.example" },
			}),
		).toEqual(["https://a.example", "smtp.example.com", "https://b.example"]);
	});

	it("reports the first refused target", async () => {
		expect(
			await checkOutboundInput(
				{ name: "s3", endpoint: "http://10.0.0.8:9000" },
				publicDns,
			),
		).toContain("10.0.0.8");
	});
});

describe("clientIpFrom", () => {
	const headers = new Headers({
		"cf-connecting-ip": "1.1.1.1",
		"x-real-ip": "41.202.219.10",
		"x-forwarded-for": "41.202.219.10",
	});

	it("ignores CF-Connecting-IP unless the panel is behind Cloudflare", () => {
		expect(clientIpFrom(headers, false)).toBe("41.202.219.10");
		expect(clientIpFrom(headers, true)).toBe("1.1.1.1");
	});

	it("falls back to X-Forwarded-For", () => {
		expect(
			clientIpFrom(new Headers({ "x-forwarded-for": "8.8.8.8, 10.0.0.2" })),
		).toBe("8.8.8.8");
	});
});

describe("withSecureTraefikApi", () => {
	const config = `# managed by Olympe
providers:
  docker:
    exposedByDefault: false
api:
  insecure: true
entryPoints:
  web:
    address: :80
`;

	it("turns the open API off and keeps the rest", () => {
		const updated = withSecureTraefikApi(config) ?? "";
		expect(updated).toContain("insecure: false");
		expect(updated).toContain("# managed by Olympe");
		expect(updated).toContain("exposedByDefault: false");
		expect(updated).toContain("address: :80");
	});

	it("leaves an already closed API alone", () => {
		expect(
			withSecureTraefikApi(config.replace("insecure: true", "insecure: false")),
		).toBeNull();
		expect(withSecureTraefikApi("entryPoints: {}\n")).toBeNull();
	});
});

describe("hardenComposeServices", () => {
	it("adds dropped capabilities and no-new-privileges once", () => {
		const spec = {
			services: {
				web: { image: "nginx", cap_drop: ["NET_ADMIN"] },
				worker: { image: "node" },
			},
		};
		hardenComposeServices(spec);
		hardenComposeServices(spec);
		expect(spec.services.web).toMatchObject({
			cap_drop: ["NET_ADMIN", "NET_RAW", "MKNOD", "AUDIT_WRITE", "SETFCAP"],
			security_opt: ["no-new-privileges:true"],
		});
		expect(spec.services.worker).toMatchObject({
			security_opt: ["no-new-privileges:true"],
		});
	});
});

describe("redactServerSettingsForClient", () => {
	it("hides the monitoring token and operator settings", () => {
		const redacted = redactServerSettingsForClient({
			serverIp: "45.81.7.27",
			host: "panel.ktc-org.com",
			letsEncryptEmail: "ops@example.com",
			telemetryProviderIds: ["t1"],
			vectorAgentOrganizationId: "org",
			metricsConfig: {
				server: { token: "secret", urlCallback: "https://cb", port: 4500 },
				containers: { refreshRate: 60 },
			},
		});
		expect(redacted.serverIp).toBe("45.81.7.27");
		expect(redacted.letsEncryptEmail).toBeNull();
		expect(redacted.telemetryProviderIds).toEqual([]);
		expect(redacted.vectorAgentOrganizationId).toBeNull();
		expect(redacted.metricsConfig?.server).toMatchObject({
			token: "",
			urlCallback: "",
			port: 4500,
		});
		expect(redacted.metricsConfig?.containers).toEqual({ refreshRate: 60 });
	});
});

describe("DATABASE_USER_PATTERN", () => {
	it.each(["postgres", "app_user", "my.app-1"])("accepts %s", (name) => {
		expect(DATABASE_USER_PATTERN.test(name)).toBe(true);
	});

	it.each(["", "1user", 'a"; DROP USER x; --', "a b", "a'b", "a`b"])(
		"refuses %s",
		(name) => {
			expect(DATABASE_USER_PATTERN.test(name)).toBe(false);
		},
	);
});
