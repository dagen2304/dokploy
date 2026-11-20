import http from "node:http";
import {
	createDefaultMiddlewares,
	createDefaultServerTraefikConfig,
	createDefaultTraefikConfig,
	IS_CLOUD,
	initCancelDeployments,
	initCronJobs,
	initEnterpriseBackupCronJobs,
	initializeNetwork,
	initSchedules,
	initVolumeBackupsCronJobs,
	restoreInterruptedTraefik,
	sendDokployRestartNotifications,
	setupDirectories,
	startTraefikAfterFailedBoot,
} from "@dokploy/server";
import { getOlympeConfig } from "@dokploy/server/services/olympe/config";
import { initOlympeJobs } from "@dokploy/server/services/olympe/jobs";
import { config } from "dotenv";
import next from "next";
import packageInfo from "../package.json";
import { initOnboardingEmailJobs } from "./utils/onboarding-emails";
import { setupDockerContainerLogsWebSocketServer } from "./wss/docker-container-logs";
import { setupDockerContainerTerminalWebSocketServer } from "./wss/docker-container-terminal";
import { setupDockerStatsMonitoringSocketServer } from "./wss/docker-stats";
import { setupDrawerLogsWebSocketServer } from "./wss/drawer-logs";
import { setupDeploymentLogsWebSocketServer } from "./wss/listen-deployment";
import { setupSandboxExecWebSocketServer } from "./wss/sandbox-exec";
import { setupTerminalWebSocketServer } from "./wss/terminal";

config({ path: ".env" });
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const dev = process.env.NODE_ENV !== "production";

// Initialize critical directories and Traefik config BEFORE Next.js starts
// This prevents race conditions with the install script
if (process.env.NODE_ENV === "production" && !IS_CLOUD) {
	setupDirectories();
	createDefaultTraefikConfig();
	createDefaultServerTraefikConfig();
	console.log("✅ initialization complete");
}

const app = next({ dev, turbopack: process.env.TURBOPACK === "1" });
const handle = app.getRequestHandler();
void app.prepare().then(async () => {
	try {
		console.log("Running DokployVersion: ", packageInfo.version);
		// Panel host only, without includeSubDomains: client apps live on
		// subdomains of the same zone and choose their own HTTPS policy.
		const sendHsts = getOlympeConfig().multiTenant;
		const server = http.createServer((req, res) => {
			if (sendHsts && req.headers["x-forwarded-proto"] === "https") {
				res.setHeader("Strict-Transport-Security", "max-age=31536000");
			}
			handle(req, res);
		});

		// WEBSOCKET
		setupDrawerLogsWebSocketServer(server);
		setupDeploymentLogsWebSocketServer(server);
		setupDockerContainerLogsWebSocketServer(server);
		setupDockerContainerTerminalWebSocketServer(server);
		setupTerminalWebSocketServer(server);
		setupSandboxExecWebSocketServer(server);
		if (!IS_CLOUD) {
			setupDockerStatsMonitoringSocketServer(server);
		}

		server.listen(PORT, HOST);
		console.log(`Server Started on: http://${HOST}:${PORT}`);
		if (process.env.NODE_ENV === "production" && !IS_CLOUD) {
			createDefaultMiddlewares();
			await initializeNetwork();
			await restoreInterruptedTraefik().catch((error) => {
				console.error("Failed to restore Traefik:", error);
			});
			await startTraefikAfterFailedBoot().catch((error) => {
				console.error("Failed to start Traefik:", error);
			});
			await initCronJobs();
			await initSchedules();
			await initCancelDeployments();
			await initVolumeBackupsCronJobs();
			initOlympeJobs();
			await sendDokployRestartNotifications();
		}
		await initEnterpriseBackupCronJobs();
		if (IS_CLOUD) {
			initOnboardingEmailJobs();
		}

		if (!IS_CLOUD) {
			console.log("Starting Deployment Worker");
			const { startDeploymentWorker } = await import("./queues/queueSetup");
			await startDeploymentWorker();
		}
	} catch (e) {
		console.error("Main Server Error", e);
	}
});
