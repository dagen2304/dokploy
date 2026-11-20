import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// The panel container sits on dokploy-network next to Postgres, Redis and
// Traefik, and can reach the host's own ports: a URL a client saves (webhook,
// AI endpoint, S3, Git, registry, vault) must never point there.
const blocked = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) {
	blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["64:ff9b::", 96],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	blocked.addSubnet(network, prefix, "ipv6");
}

export const isPrivateAddress = (address: string) => {
	const family = isIP(address);
	if (family === 4) return blocked.check(address, "ipv4");
	// BlockList treats IPv4-mapped IPv6 as IPv4, so a ::ffff:0:0/96 subnet
	// would match every IPv4 address: mapped addresses are refused here.
	if (family === 6) {
		return (
			address.toLowerCase().startsWith("::ffff:") ||
			blocked.check(address, "ipv6")
		);
	}
	return true;
};

const INTERNAL_SUFFIXES = [
	".localhost",
	".local",
	".internal",
	".lan",
	".home.arpa",
];

export const hostOfTarget = (value: string): string | null => {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
		? trimmed
		: `http://${trimmed}`;
	try {
		const host = new URL(withScheme).hostname.toLowerCase();
		return host.replace(/^\[|\]$/g, "").replace(/\.$/, "") || null;
	} catch {
		return null;
	}
};

export type Resolver = (host: string) => Promise<string[]>;

const resolveWithDns: Resolver = async (host) =>
	(await lookup(host, { all: true, verbatim: true })).map(
		(entry) => entry.address,
	);

export const checkOutboundTarget = async (
	value: string,
	resolve: Resolver = resolveWithDns,
): Promise<string | null> => {
	if (!value.trim()) return null;
	const host = hostOfTarget(value);
	if (!host) return `adresse « ${value} » invalide`;
	if (isIP(host)) {
		return isPrivateAddress(host)
			? `l'adresse « ${host} » est une adresse interne`
			: null;
	}
	if (
		!host.includes(".") ||
		INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
	) {
		return `« ${host} » est un nom interne`;
	}
	let addresses: string[];
	try {
		addresses = await resolve(host);
	} catch {
		return `le nom « ${host} » est introuvable`;
	}
	if (addresses.length === 0) return `le nom « ${host} » est introuvable`;
	if (addresses.some(isPrivateAddress)) {
		return `« ${host} » pointe vers une adresse interne`;
	}
	return null;
};

const TARGET_KEY = /(url|endpoint|webhook|host|server)$/i;
const NOT_A_TARGET = new Set(["serverid", "buildserverid"]);

export const collectOutboundTargets = (input: unknown, depth = 0): string[] => {
	if (!input || typeof input !== "object" || depth > 4) return [];
	const targets: string[] = [];
	for (const [key, value] of Object.entries(input)) {
		if (typeof value === "string") {
			if (TARGET_KEY.test(key) && !NOT_A_TARGET.has(key.toLowerCase())) {
				targets.push(value);
			}
		} else if (value && typeof value === "object") {
			targets.push(...collectOutboundTargets(value, depth + 1));
		}
	}
	return targets;
};

export const checkOutboundInput = async (
	input: unknown,
	resolve: Resolver = resolveWithDns,
): Promise<string | null> => {
	for (const target of collectOutboundTargets(input)) {
		const problem = await checkOutboundTarget(target, resolve);
		if (problem) return problem;
	}
	return null;
};
