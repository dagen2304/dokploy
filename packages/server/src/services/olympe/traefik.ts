import { parseDocument } from "yaml";
import {
	readMainConfig,
	writeMainConfig,
} from "../../utils/traefik/web-server";
import { reloadDockerResource } from "../settings";
import { getOlympeConfig } from "./config";

export const withSecureTraefikApi = (yamlText: string): string | null => {
	const document = parseDocument(yamlText);
	if (document.getIn(["api", "insecure"]) !== true) return null;
	document.setIn(["api", "insecure"], false);
	return document.toString();
};

// Installations made before Olympe keep `api.insecure: true` in traefik.yml,
// which serves the whole routing table on :8080 of every client network.
// Static configuration only applies on restart, hence the reload.
export const closeTraefikInsecureApi = async () => {
	if (!getOlympeConfig().multiTenant) return false;
	const current = readMainConfig();
	if (!current) return false;
	const updated = withSecureTraefikApi(current);
	if (!updated) return false;
	writeMainConfig(updated);
	await reloadDockerResource("dokploy-traefik");
	console.log("[olympe] Traefik API closed (api.insecure: false)");
	return true;
};
