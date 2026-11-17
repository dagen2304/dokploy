import { applications } from "@dokploy/server/db/schema";
import {
	expiresAt,
	reviveRow,
	TRASH_RETENTION_DAYS,
} from "@dokploy/server/services/trash";
import { describe, expect, it } from "vitest";

describe("trash", () => {
	it("keeps items for the retention period", () => {
		const deletedAt = "2026-11-17T10:00:00.000Z";
		expect(expiresAt(deletedAt).toISOString()).toBe(
			new Date(
				Date.parse(deletedAt) + TRASH_RETENTION_DAYS * 86_400_000,
			).toISOString(),
		);
	});

	it("drops columns that no longer exist when restoring an old snapshot", () => {
		const row = reviveRow(applications, {
			applicationId: "a1",
			name: "api",
			columnRemovedUpstream: "x",
		});
		expect(row).toEqual({ applicationId: "a1", name: "api" });
	});
});
