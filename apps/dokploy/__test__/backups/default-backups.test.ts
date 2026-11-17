import { getDefaultBackupConfig } from "@dokploy/server/services/default-backups";
import { describe, expect, it } from "vitest";

describe("getDefaultBackupConfig", () => {
	it("is disabled until a destination is named", () => {
		expect(getDefaultBackupConfig({})).toBeNull();
		expect(
			getDefaultBackupConfig({ DEFAULT_BACKUP_DESTINATION: "  " }),
		).toBeNull();
	});

	it("defaults to a daily backup keeping 14 copies", () => {
		expect(
			getDefaultBackupConfig({ DEFAULT_BACKUP_DESTINATION: "S3 Bucket" }),
		).toEqual({
			destinationName: "S3 Bucket",
			schedule: "30 2 * * *",
			keepLatestCount: 14,
		});
	});

	it("accepts a custom schedule and retention, ignoring invalid counts", () => {
		expect(
			getDefaultBackupConfig({
				DEFAULT_BACKUP_DESTINATION: "R2",
				DEFAULT_BACKUP_SCHEDULE: "0 */6 * * *",
				DEFAULT_BACKUP_KEEP: "30",
			}),
		).toMatchObject({ schedule: "0 */6 * * *", keepLatestCount: 30 });
		expect(
			getDefaultBackupConfig({
				DEFAULT_BACKUP_DESTINATION: "R2",
				DEFAULT_BACKUP_KEEP: "-3",
			})?.keepLatestCount,
		).toBe(14);
	});
});
