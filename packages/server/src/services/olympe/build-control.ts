import { db } from "@dokploy/server/db";
import {
	applications,
	compose,
	deployments,
	previewDeployments,
} from "@dokploy/server/db/schema";
import {
	execAsync,
	execAsyncRemote,
} from "@dokploy/server/utils/process/execAsync";
import { and, desc, eq, isNull } from "drizzle-orm";
import { quote } from "shell-quote";

export type DeploymentRef = {
	applicationId?: string;
	composeId?: string;
	previewDeploymentId?: string;
};

// Every deployment runs as `(…) >> <logPath> 2>&1`, so its log path, unique
// per deployment, is on the command line of the shell that runs it. Stopping
// that shell's process tree stops this deployment and nothing else: the old
// `pkill -f "docker build"` stopped every build on the server, other clients'
// included. The path is passed in two pieces so that the stopping shell's own
// command line never contains it whole.
export const stopDeploymentCommand = (logPath: string, note?: string) => {
	const half = Math.ceil(logPath.length / 2);
	const lines = [
		`LOG="$(printf '%s%s' ${quote([logPath.slice(0, half)])} ${quote([logPath.slice(half)])})"`,
		'tree() { for c in $(pgrep -P "$1"); do tree "$c" "$2"; done; kill -"$2" "$1" 2>/dev/null; }',
		...(note ? [`printf '\\n%s\\n' ${quote([note])} >> "$LOG"`] : []),
		'for p in $(pgrep -f -- "$LOG"); do tree "$p" INT; done',
		"sleep 5",
		'for p in $(pgrep -f -- "$LOG"); do tree "$p" KILL; done',
		"true",
	];
	return lines.join("\n");
};

const latestRunningDeployment = async (ref: DeploymentRef) => {
	const where = ref.previewDeploymentId
		? eq(deployments.previewDeploymentId, ref.previewDeploymentId)
		: ref.composeId
			? eq(deployments.composeId, ref.composeId)
			: ref.applicationId
				? and(
						eq(deployments.applicationId, ref.applicationId),
						isNull(deployments.previewDeploymentId),
					)
				: undefined;
	if (!where) return null;
	const [row] = await db
		.select({ logPath: deployments.logPath })
		.from(deployments)
		.where(and(where, eq(deployments.status, "running")))
		.orderBy(desc(deployments.createdAt))
		.limit(1);
	return row ?? null;
};

// Where the deployment's commands run: the build server if any, else the
// service's server (null: the panel's own server).
const buildHostOf = async (ref: DeploymentRef): Promise<string | null> => {
	if (ref.composeId) {
		const row = await db.query.compose.findFirst({
			where: eq(compose.composeId, ref.composeId),
			columns: { serverId: true },
		});
		return row?.serverId ?? null;
	}
	let applicationId = ref.applicationId;
	if (ref.previewDeploymentId) {
		const preview = await db.query.previewDeployments.findFirst({
			where: eq(
				previewDeployments.previewDeploymentId,
				ref.previewDeploymentId,
			),
			columns: { applicationId: true },
		});
		applicationId = preview?.applicationId;
	}
	if (!applicationId) return null;
	const app = await db.query.applications.findFirst({
		where: eq(applications.applicationId, applicationId),
		columns: { serverId: true, buildServerId: true },
	});
	return app?.buildServerId ?? app?.serverId ?? null;
};

/** Stops the running deployment of one service. Returns false if none runs. */
export const stopRunningDeployment = async (
	ref: DeploymentRef,
	note?: string,
) => {
	const deployment = await latestRunningDeployment(ref);
	if (!deployment) return false;
	const host = await buildHostOf(ref);
	const command = stopDeploymentCommand(deployment.logPath, note);
	if (host) await execAsyncRemote(host, command);
	else await execAsync(command);
	return true;
};

export const buildTimeoutMs = (env: Record<string, string | undefined>) => {
	const minutes = Number.parseInt(env.OLYMPE_BUILD_TIMEOUT_MIN ?? "", 10);
	if (Number.isFinite(minutes) && minutes >= 0) return minutes * 60_000;
	return 30 * 60_000;
};
