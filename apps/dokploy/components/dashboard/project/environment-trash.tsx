import { formatDistanceToNow } from "date-fns";
import { RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { api } from "@/utils/api";

interface Props {
	projectId: string;
	environmentId: string;
	onRestored?: () => void;
}

export const EnvironmentTrash = ({
	projectId,
	environmentId,
	onRestored,
}: Props) => {
	const utils = api.useUtils();
	const [open, setOpen] = useState(false);
	const [restored, setRestored] = useState<{
		type: string;
		id: string;
		name: string;
	} | null>(null);
	// Owners and admins only: for other roles the query is refused and the
	// button stays hidden.
	const { data: items } = api.trash.list.useQuery(
		{ environmentId },
		{ retry: false },
	);
	const restore = api.trash.restore.useMutation();
	const remove = api.trash.remove.useMutation();

	if (!items) return null;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setRestored(null);
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" className="gap-2">
					<Trash2 className="size-4" />
					Trash{items.length > 0 ? ` (${items.length})` : ""}
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Trash</DialogTitle>
					<DialogDescription>
						Services deleted from this environment in the last 7 days. Restoring
						brings back their configuration, domains and backups; data kept in
						their volumes is still there. Deploy the service afterwards to start
						it.
					</DialogDescription>
				</DialogHeader>

				{restored && (
					<div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
						{restored.name} is back.{" "}
						<Link
							className="font-medium underline"
							href={`/dashboard/project/${projectId}/environment/${environmentId}/services/${restored.type}/${restored.id}`}
						>
							Open it to deploy
						</Link>
					</div>
				)}

				{items.length === 0 ? (
					<p className="py-6 text-center text-sm text-muted-foreground">
						The trash is empty.
					</p>
				) : (
					<ul className="flex flex-col divide-y">
						{items.map((item) => (
							<li
								key={item.id}
								className="flex items-center justify-between gap-3 py-3"
							>
								<div className="min-w-0">
									<p className="truncate text-sm font-medium">{item.name}</p>
									<p className="text-xs text-muted-foreground">
										{item.type} · deleted{" "}
										{formatDistanceToNow(new Date(item.deletedAt), {
											addSuffix: true,
										})}{" "}
										· removed for good{" "}
										{formatDistanceToNow(new Date(item.expiresAt), {
											addSuffix: true,
										})}
									</p>
								</div>
								<div className="flex shrink-0 gap-2">
									<Button
										size="sm"
										isLoading={
											restore.isPending && restore.variables?.id === item.id
										}
										onClick={async () => {
											try {
												await restore.mutateAsync({ id: item.id });
												setRestored({
													type: item.type,
													id: item.id,
													name: item.name,
												});
												await utils.trash.list.invalidate();
												await utils.environment.one.invalidate({
													environmentId,
												});
												onRestored?.();
											} catch (error) {
												toast.error(
													error instanceof Error
														? error.message
														: "Restore failed",
												);
											}
										}}
									>
										<RotateCcw className="mr-1.5 size-4" />
										Restore
									</Button>
									<Button
										size="sm"
										variant="ghost"
										title="Delete for good"
										isLoading={
											remove.isPending && remove.variables?.id === item.id
										}
										onClick={async () => {
											await remove.mutateAsync({ id: item.id });
											await utils.trash.list.invalidate();
										}}
									>
										<Trash2 className="size-4" />
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
};
