import {
	buildDiagnosisPrompt,
	envValues,
	redactLog,
} from "@dokploy/server/services/deploy-diagnosis";
import { describe, expect, it } from "vitest";

describe("redactLog", () => {
	it("masks the service's own variable values", () => {
		const secrets = envValues("SESSION_SECRET=very-private-value\nPORT=3000");
		const out = redactLog("starting with very-private-value on 3000", secrets);
		expect(out).toBe("starting with [REDACTED] on 3000");
	});

	it("masks well-known token shapes and credentials in URLs", () => {
		const log = [
			"git clone https://me:ghp_abcdefghijklmnopqrstuvwxyz1234@github.com/me/app.git",
			"Authorization: Bearer abcdefghijklmnop123456",
			"key sk_live_ABCDEFGHIJKLMNOPQRSTUV",
			"AWS AKIAABCDEFGHIJKLMNOP",
			'DB_PASSWORD="hunter2 with spaces"',
			"postgresql://shop:s3cr3t@db:5432/shop",
		].join("\n");
		const out = redactLog(log, []);
		for (const secret of [
			"ghp_abcdef",
			"abcdefghijklmnop123456",
			"sk_live_",
			"AKIAABCD",
			"hunter2",
			"s3cr3t",
		]) {
			expect(out).not.toContain(secret);
		}
		expect(out).toContain("postgresql://shop:[REDACTED]@db:5432/shop");
	});

	it("keeps the lines needed to understand the failure", () => {
		const log =
			"Error: Cannot find module 'express'\nVariable names: SESSION_SECRET, PORT";
		expect(redactLog(log, ["abc"])).toBe(log);
	});

	it("ignores values too short to be secrets", () => {
		expect(redactLog("listening on 3000", envValues("PORT=3000"))).toBe(
			"listening on 3000",
		);
	});
});

describe("buildDiagnosisPrompt", () => {
	it("asks for a French answer with the expected sections", () => {
		const prompt = buildDiagnosisPrompt("Type: application", "Error: boom");
		expect(prompt).toContain("answer in French");
		expect(prompt).toContain("## Cause probable");
		expect(prompt).toContain("Error: boom");
	});
});
