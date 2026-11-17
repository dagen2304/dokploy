import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDockerResourceType = vi.hoisted(() => vi.fn());
const mockSpawnAsync = vi.hoisted(() => vi.fn());
const mockGetUpdateData = vi.hoisted(() => vi.fn());

const noop = vi.fn();

vi.mock("@dokploy/server", () => ({
	CLEANUP_CRON_JOB: "0 0 * * *",
	checkGPUStatus: noop,
	checkPortInUse: noop,
	checkPostgresHealth: noop,
	checkTraefikHealth: noop,
	cleanupAll: noop,
	cleanupAllBackground: noop,
	cleanupBuilders: noop,
	cleanupContainers: noop,
	cleanupImages: noop,
	cleanupSystem: noop,
	cleanupVolumes: noop,
	DEFAULT_UPDATE_DATA: { latestVersion: null, updateAvailable: false },
	findServerById: noop,
	getDockerDiskUsage: noop,
	getDockerResourceType: mockGetDockerResourceType,
	getDokployImageTag: () => "canary",
	getLogCleanupStatus: noop,
	getUpdateData: mockGetUpdateData,
	getWebServerSettings: noop,
	IS_CLOUD: false,
	parseRawConfig: noop,
	paths: () => ({
		MAIN_TRAEFIK_PATH: "/tmp",
		LOGS_PATH: "/tmp",
		MONITORING_PATH: "/tmp",
		DYNAMIC_TRAEFIK_PATH: "/tmp",
	}),
	prepareEnvironmentVariables: noop,
	processLogs: noop,
	readConfig: noop,
	readConfigInPath: noop,
	readDirectory: noop,
	readEnvironmentVariables: noop,
	readMainConfig: noop,
	readMonitoringConfig: noop,
	readPorts: noop,
	recreateDirectory: noop,
	reloadDockerResource: noop,
	sendDockerCleanupNotifications: noop,
	setupGPUSupport: noop,
	spawnAsync: mockSpawnAsync,
	startLogCleanup: noop,
	stopLogCleanup: noop,
	updateLetsEncryptEmail: noop,
	updateServerById: noop,
	updateServerTraefik: noop,
	updateWebServerSettings: noop,
	writeConfig: noop,
	writeMainConfig: noop,
	writeTraefikConfigInPath: noop,
	writeTraefikSetup: noop,
}));

vi.mock("@dokploy/server/lib/auth", () => ({
	validateRequest: vi.fn(),
}));

vi.mock("@/server/api/root", () => ({
	appRouter: {},
}));

vi.mock("@/server/api/utils/audit", () => ({
	audit: vi.fn(async () => undefined),
}));

vi.mock("@/server/queues/queueSetup", () => ({
	cleanAllDeploymentQueue: vi.fn(),
}));

vi.mock("@/server/utils/backup", () => ({
	removeJob: vi.fn(),
	schedule: vi.fn(),
}));

const { settingsRouter } = await import("@/server/api/routers/settings");

const caller = settingsRouter.createCaller({
	session: { activeOrganizationId: "org-1" },
	user: { id: "user-1", email: "user@example.com", role: "owner" },
} as Parameters<typeof settingsRouter.createCaller>[0]);

// KTC fork: the panel runs its own image, so in-panel updates (which pull
// the official dokploy/dokploy image) are disabled whatever the setup.
describe("settings.updateServer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetUpdateData.mockResolvedValue({
			latestVersion: "v9.9.9",
			updateAvailable: true,
		});
	});

	it.each(["service", "standalone", "unknown"])(
		"refuses to update and never swaps the image (%s)",
		async (resourceType) => {
			mockGetDockerResourceType.mockResolvedValue(resourceType);

			await expect(caller.updateServer()).rejects.toMatchObject({
				code: "BAD_REQUEST",
				message: expect.stringContaining("In-panel updates are disabled"),
			});

			expect(mockSpawnAsync).not.toHaveBeenCalled();
		},
	);
});

describe("settings.getUpdateData", () => {
	it("never reports an official update as available", async () => {
		mockGetUpdateData.mockResolvedValue({
			latestVersion: "v9.9.9",
			updateAvailable: true,
		});

		await expect(caller.getUpdateData()).resolves.toMatchObject({
			updateAvailable: false,
		});
	});
});
