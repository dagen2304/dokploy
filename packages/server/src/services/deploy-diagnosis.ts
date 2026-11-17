import { selectAIProvider } from "@dokploy/server/utils/ai/select-ai-provider";
import {
	execAsync,
	execAsyncRemote,
} from "@dokploy/server/utils/process/execAsync";
import { generateText } from "ai";
import { parse } from "dotenv";
import { quote } from "shell-quote";
import { getAiSettingsByOrganizationId } from "./ai";
import { findApplicationById } from "./application";
import { findComposeById } from "./compose";
import { findDeploymentById } from "./deployment";

// KTC fork: "why did this deploy fail?" — reads the end of the build log,
// strips secrets, and asks the organization's configured AI provider.

const LOG_TAIL_LINES = 200;
const MAX_LOG_CHARS = 12_000;
const MIN_SECRET_LENGTH = 6;

export class DiagnosisError extends Error {}

const SECRET_PATTERNS: [RegExp, string][] = [
	[
		/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
		"[REDACTED]",
	],
	[
		/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
		"[REDACTED]",
	],
	[/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, "[REDACTED]"],
	[
		/\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY)[A-Za-z0-9_]*\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
		"$1[REDACTED]",
	],
	[/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
	[/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED]"],
	[
		/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
		"[REDACTED]",
	],
	[/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]"],
	// user:password@ in connection strings and git remotes
	[/(\b[a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s]+(@)/gi, "$1[REDACTED]$2"],
];

/**
 * Replaces every value of the service's variables (and well-known token
 * shapes) by [REDACTED] before the log leaves the server.
 */
export const redactLog = (log: string, secretValues: string[]) => {
	let redacted = log;
	const values = [...new Set(secretValues)]
		.filter((value) => value.length >= MIN_SECRET_LENGTH)
		.sort((a, b) => b.length - a.length);
	for (const value of values) {
		redacted = redacted.split(value).join("[REDACTED]");
	}
	for (const [pattern, replacement] of SECRET_PATTERNS) {
		redacted = redacted.replace(pattern, replacement);
	}
	return redacted;
};

export const envValues = (...sources: (string | null | undefined)[]) =>
	sources.flatMap((source) => Object.values(parse(source ?? "")));

const readLogTail = async (logPath: string, serverId?: string | null) => {
	const command = `tail -n ${LOG_TAIL_LINES} ${quote([logPath])}`;
	const { stdout } = serverId
		? await execAsyncRemote(serverId, command)
		: await execAsync(command);
	return stdout.length > MAX_LOG_CHARS ? stdout.slice(-MAX_LOG_CHARS) : stdout;
};

export const buildDiagnosisPrompt = (context: string, log: string) => `
You are a senior DevOps engineer helping someone who deploys apps on a
self-hosted PaaS (Dokploy fork named KTC: Docker Swarm, Traefik, builds with
Nixpacks, Railpack, Heroku buildpacks or a Dockerfile).

A deployment failed. Using the service configuration and the end of the
build/deploy log below, answer in French, in Markdown, with exactly these
sections:

## Cause probable
One or two sentences. Quote the decisive log line in a code span.

## Correction
Numbered, concrete steps. Say where to change things (in the repository, or
in the panel: tab General / Environment / Domains / Advanced). Include the
exact code, config or command when useful, in fenced code blocks.

## Si ça ne suffit pas
At most two short leads.

Be concise. If the log does not show the cause, say so and say what to check.
Values shown as [REDACTED] are hidden secrets: never ask for them.

### Service configuration
${context}

### End of the log
\`\`\`
${log}
\`\`\`
`;

export const diagnoseDeployment = async (
	deploymentId: string,
	organizationId: string,
) => {
	const deployment = await findDeploymentById(deploymentId);
	if (deployment.status !== "error") {
		throw new DiagnosisError("Only failed deployments can be analyzed");
	}

	let serverId: string | null | undefined;
	let secrets: string[] = [];
	let context = "";

	if (deployment.application) {
		const app = await findApplicationById(deployment.application.applicationId);
		if (app.environment.project.organizationId !== organizationId) {
			throw new DiagnosisError("Deployment not found");
		}
		serverId = app.serverId;
		secrets = envValues(
			app.env,
			app.buildArgs,
			app.buildSecrets,
			app.environment.env,
			app.environment.project.env,
		);
		context = [
			"Type: application",
			`Source: ${app.sourceType}`,
			`Build type: ${app.buildType}`,
			app.buildType === "dockerfile"
				? `Dockerfile: ${app.dockerfile ?? "Dockerfile"} (context: ${app.dockerContextPath ?? "."})`
				: null,
			`Build path: ${app.buildPath ?? "/"}`,
			app.sourceType === "docker" ? `Image: ${app.dockerImage}` : null,
			`Domain ports: ${app.domains.map((d) => d.port).join(", ") || "none"}`,
			`Variable names: ${Object.keys(parse(app.env ?? "")).join(", ") || "none"}`,
		]
			.filter(Boolean)
			.join("\n");
	} else if (deployment.compose) {
		const service = await findComposeById(deployment.compose.composeId);
		if (service.environment.project.organizationId !== organizationId) {
			throw new DiagnosisError("Deployment not found");
		}
		serverId = service.serverId;
		secrets = envValues(
			service.env,
			service.environment.env,
			service.environment.project.env,
		);
		context = [
			"Type: docker compose",
			`Source: ${service.sourceType}`,
			`Compose path: ${service.composePath}`,
			`Variable names: ${Object.keys(parse(service.env ?? "")).join(", ") || "none"}`,
		].join("\n");
	} else {
		throw new DiagnosisError(
			"Only application and compose deployments can be analyzed",
		);
	}

	const aiSetting = (await getAiSettingsByOrganizationId(organizationId)).find(
		(setting) => setting.isEnabled,
	);
	if (!aiSetting) {
		throw new DiagnosisError(
			"No AI provider is enabled. Add one in Settings > AI.",
		);
	}

	let log: string;
	try {
		log = await readLogTail(deployment.logPath, serverId);
	} catch {
		throw new DiagnosisError("The log of this deployment could not be read");
	}
	if (!log.trim()) {
		throw new DiagnosisError("The log of this deployment is empty");
	}

	const provider = selectAIProvider(aiSetting);
	const result = await generateText({
		model: provider(aiSetting.model),
		prompt: buildDiagnosisPrompt(
			redactLog(context, secrets),
			redactLog(log, secrets),
		),
	});
	return { markdown: result.text, model: aiSetting.model };
};
