import copy from "copy-to-clipboard";
import { Bot, Copy, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
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

export const DiagnoseDeployment = ({
	deploymentId,
}: {
	deploymentId: string;
}) => {
	const [open, setOpen] = useState(false);
	const diagnose = api.deployDiagnosis.diagnose.useMutation();

	const run = () => diagnose.mutate({ deploymentId });

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next && !diagnose.data && !diagnose.isPending) run();
			}}
		>
			<DialogTrigger asChild>
				<Button variant="secondary" className="w-full gap-2 sm:w-auto">
					<Bot className="size-4" />
					Why did it fail?
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Bot className="size-5" />
						Deployment diagnosis
					</DialogTitle>
					<DialogDescription>
						The end of the log and the service settings are sent to your AI
						provider, with variable values and tokens masked.
					</DialogDescription>
				</DialogHeader>

				{diagnose.isPending && (
					<div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						Reading the log…
					</div>
				)}

				{diagnose.error && (
					<div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
						<span>{diagnose.error.message}</span>
						{diagnose.error.message.includes("Settings > AI") && (
							<Link
								href="/dashboard/settings/ai"
								className="font-medium underline"
							>
								Open Settings &gt; AI
							</Link>
						)}
					</div>
				)}

				{diagnose.data && (
					<>
						<div className="prose prose-sm dark:prose-invert max-w-none">
							<ReactMarkdown>{diagnose.data.markdown}</ReactMarkdown>
						</div>
						<div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
							<span>Model: {diagnose.data.model}</span>
							<div className="flex gap-2">
								<Button
									size="sm"
									variant="ghost"
									onClick={() => {
										copy(diagnose.data?.markdown ?? "");
										toast.success("Copied");
									}}
								>
									<Copy className="mr-1.5 size-3.5" />
									Copy
								</Button>
								<Button size="sm" variant="ghost" onClick={run}>
									<RotateCcw className="mr-1.5 size-3.5" />
									Again
								</Button>
							</div>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
};
