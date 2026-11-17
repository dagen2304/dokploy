import { DatabaseBackup } from "lucide-react";
import { toast } from "sonner";
import { AlertBlock } from "@/components/shared/alert-block";
import { Button } from "@/components/ui/button";
import { api } from "@/utils/api";

const SETUP_COMMAND =
	'docker service update --env-add DEFAULT_BACKUP_DESTINATION="S3 Bucket" dokploy';

export const DefaultBackups = () => {
	const utils = api.useUtils();
	const { data: status } = api.backup.defaultBackupStatus.useQuery();
	const { mutateAsync: backfill, isPending } =
		api.backup.backfillDefaultBackups.useMutation();

	if (!status) return null;

	const { config, destinationFound, withoutBackup } = status;

	return (
		<div className="flex flex-col gap-3 rounded-lg border p-4">
			<div className="flex items-center gap-2 font-medium">
				<DatabaseBackup className="size-4 text-muted-foreground" />
				Default database backups
			</div>

			{!config ? (
				<p className="text-sm text-muted-foreground">
					Not enabled. Run on the server, with the name of a destination from
					Settings &gt; S3 Destinations:
					<code className="mt-2 block rounded bg-muted px-2 py-1 text-xs break-all">
						{SETUP_COMMAND}
					</code>
				</p>
			) : !destinationFound ? (
				<AlertBlock type="warning">
					Destination "{config.destinationName}" was not found in this
					organization. New databases are not backed up automatically.
				</AlertBlock>
			) : (
				<p className="text-sm text-muted-foreground">
					Every new PostgreSQL, MySQL and MariaDB database is backed up to{" "}
					<span className="font-medium text-foreground">
						{config.destinationName}
					</span>{" "}
					on schedule <code>{config.schedule}</code> (UTC), keeping the latest{" "}
					{config.keepLatestCount} copies.
				</p>
			)}

			{withoutBackup.length > 0 ? (
				<div className="flex flex-col gap-2">
					<p className="text-sm">
						{withoutBackup.length} database
						{withoutBackup.length > 1 ? "s have" : " has"} no backup:{" "}
						<span className="text-muted-foreground">
							{withoutBackup
								.map((db) => `${db.projectName} / ${db.name}`)
								.join(", ")}
						</span>
					</p>
					{config && destinationFound && (
						<Button
							size="sm"
							className="self-start"
							isLoading={isPending}
							onClick={async () => {
								try {
									const result = await backfill();
									toast.success(
										`${result.created.length} backup${result.created.length > 1 ? "s" : ""} created`,
									);
									await utils.backup.defaultBackupStatus.invalidate();
								} catch (error) {
									toast.error(
										error instanceof Error ? error.message : "Backfill failed",
									);
								}
							}}
						>
							Back up {withoutBackup.length > 1 ? "them all" : "it"} with the
							defaults
						</Button>
					)}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					Every PostgreSQL, MySQL and MariaDB database has a backup.
				</p>
			)}
		</div>
	);
};
