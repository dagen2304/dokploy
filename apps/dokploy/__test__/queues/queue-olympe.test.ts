import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildTimeoutMs,
	stopDeploymentCommand,
} from "@dokploy/server/services/olympe/build-control";
import { describe, expect, it } from "vitest";
import {
	getDedupeKey,
	InMemoryQueue,
} from "../../server/queues/in-memory-queue";
import type { DeploymentJob } from "../../server/queues/queue-types";

const appJob = (applicationId: string, titleLog = "deploy"): DeploymentJob => ({
	applicationId,
	titleLog,
	descriptionLog: "",
	type: "deploy",
	applicationType: "application",
});

const previewJob = (applicationId: string, previewDeploymentId: string) =>
	({
		applicationId,
		previewDeploymentId,
		titleLog: "preview",
		descriptionLog: "",
		type: "deploy",
		applicationType: "application-preview",
	}) as DeploymentJob;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("deduplication of waiting jobs", () => {
	it("keeps only the newest waiting job of a service", async () => {
		const ran: string[] = [];
		let release!: () => void;
		const queue = new InMemoryQueue({
			resolveConcurrency: () => 1,
			dedupeWaiting: true,
		});
		queue.process(async (job) => {
			ran.push(job.data.titleLog);
			if (job.data.titleLog === "first") {
				await new Promise<void>((r) => {
					release = r;
				});
			}
		});
		await queue.add(appJob("a", "first"));
		await wait(5);
		await queue.add(appJob("a", "second"));
		await queue.add(appJob("a", "third"));
		const waiting = await queue.getJobs(["waiting"]);
		expect(waiting.map((job) => job.data.titleLog)).toEqual(["third"]);
		release();
		await wait(10);
		expect(ran).toEqual(["first", "third"]);
	});

	it("keys previews apart from their application", () => {
		expect(getDedupeKey(previewJob("a", "p1"))).toBe("preview:p1");
		expect(getDedupeKey(previewJob("a", "p2"))).not.toBe(
			getDedupeKey(appJob("a")),
		);
	});

	it("keeps every waiting job when deduplication is off", async () => {
		const queue = new InMemoryQueue({ resolveConcurrency: () => 1 });
		queue.process(() => new Promise(() => {}));
		await queue.add(appJob("a", "first"));
		await wait(5);
		await queue.add(appJob("a", "second"));
		await queue.add(appJob("a", "third"));
		expect(await queue.getJobs(["waiting"])).toHaveLength(2);
	});
});

describe("build timeout", () => {
	it("stops a stuck job and frees its slot after the grace period", async () => {
		const stopped: string[] = [];
		const started: string[] = [];
		const queue = new InMemoryQueue({
			resolveConcurrency: () => 1,
			timeoutMs: 30,
			timeoutGraceMs: 30,
			onTimeout: async (data) => {
				stopped.push(data.titleLog);
			},
		});
		queue.process(async (job) => {
			started.push(job.data.titleLog);
			if (job.data.titleLog === "stuck") await new Promise(() => {});
		});
		await queue.add(appJob("a", "stuck"));
		await queue.add(appJob("b", "next"));
		await wait(20);
		expect(started).toEqual(["stuck"]);
		await wait(80);
		expect(stopped).toEqual(["stuck"]);
		expect(started).toEqual(["stuck", "next"]);
	});

	it("reads the limit from OLYMPE_BUILD_TIMEOUT_MIN, 30 minutes by default", () => {
		expect(buildTimeoutMs({})).toBe(30 * 60_000);
		expect(buildTimeoutMs({ OLYMPE_BUILD_TIMEOUT_MIN: "45" })).toBe(
			45 * 60_000,
		);
		expect(buildTimeoutMs({ OLYMPE_BUILD_TIMEOUT_MIN: "0" })).toBe(0);
	});
});

describe("stopDeploymentCommand", () => {
	// The shells are this test's children: once killed they stay as zombies
	// until reaped, so liveness is read from their exit event.
	const exited = (child: ReturnType<typeof spawn>) =>
		child.exitCode !== null || child.signalCode !== null;

	it("stops only the deployment whose log path it is given", async () => {
		const root = mkdtempSync(join(tmpdir(), "olympe-stop-"));
		const logs = ["client-a", "client-b"].map((name) => {
			mkdirSync(join(root, name));
			const log = join(root, name, "deploy-1.log");
			writeFileSync(log, "Initializing deployment\n");
			return log;
		});
		const runs = logs.map((log) =>
			spawn("/bin/sh", ["-c", `(sleep 300; echo end) >> ${log} 2>&1`], {
				stdio: "ignore",
			}),
		);
		await wait(200);
		const running = (log: string) => {
			try {
				return execFileSync("pgrep", ["-f", log]).toString().trim() !== "";
			} catch {
				return false;
			}
		};
		expect(running(logs[0]!) && running(logs[1]!)).toBe(true);
		const builds = () => {
			try {
				return execFileSync("pgrep", ["-f", "^sleep 300$"])
					.toString()
					.trim()
					.split("\n").length;
			} catch {
				return 0;
			}
		};
		expect(builds()).toBe(2);

		execFileSync("/bin/sh", [
			"-c",
			stopDeploymentCommand(logs[0]!, "stopped by test"),
		]);

		await wait(100);
		expect(exited(runs[0]!)).toBe(true);
		expect(exited(runs[1]!)).toBe(false);
		expect(running(logs[0]!)).toBe(false);
		expect(running(logs[1]!)).toBe(true);
		expect(builds()).toBe(1);
		expect(readFileSync(logs[0]!, "utf8")).toContain("stopped by test");
		expect(readFileSync(logs[1]!, "utf8")).not.toContain("stopped by test");
		execFileSync("/bin/sh", ["-c", stopDeploymentCommand(logs[1]!)]);
		await wait(100);
		expect(exited(runs[1]!)).toBe(true);
	}, 30_000);
});
