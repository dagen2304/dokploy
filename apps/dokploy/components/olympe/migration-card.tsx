import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api, type RouterOutputs } from "@/utils/api";

type Service =
	RouterOutputs["olympe"]["operator"]["migration"]["services"][number];

const TYPE_LABELS: Record<Service["serviceType"], string> = {
	application: "Application",
	compose: "Compose",
	postgres: "PostgreSQL",
	mysql: "MySQL",
	mariadb: "MariaDB",
	mongo: "MongoDB",
	redis: "Redis",
	libsql: "libSQL",
};

export const MigrationCard = () => {
	const utils = api.useUtils();
	const { data } = api.olympe.operator.migration.useQuery();
	const [confirming, setConfirming] = useState<Service | null>(null);
	const [running, setRunning] = useState<Service | null>(null);
	const [logs, setLogs] = useState<string[]>([]);

	api.olympe.operator.migrate.useSubscription(
		{
			serviceType: running?.serviceType ?? "application",
			serviceId: running?.serviceId ?? "",
		},
		{
			enabled: running !== null,
			onData(line) {
				setLogs((previous) => [...previous, line]);
				if (line.startsWith("Migration terminée")) {
					toast.success(`${running?.name} migré`);
					setRunning(null);
					void utils.olympe.operator.migration.invalidate();
				} else if (line.startsWith("Migration échouée")) {
					toast.error("La migration a échoué, voir le journal");
					setRunning(null);
					void utils.olympe.operator.migration.invalidate();
				}
			},
			onError(error) {
				toast.error(error.message);
				setRunning(null);
			},
		},
	);

	const start = (service: Service) => {
		setLogs([]);
		setConfirming(null);
		setRunning(service);
	};

	const targetName = data?.target?.name ?? "le serveur d'exécution";

	return (
		<Card>
			<CardHeader>
				<CardTitle>Migration vers {targetName}</CardTitle>
				<CardDescription>
					Services clients créés avant le serveur d'exécution et qui tournent
					encore sur le serveur du panel.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{!data?.target ? (
					<p className="text-sm text-muted-foreground">
						Définissez OLYMPE_TENANT_SERVER_ID sur le service dokploy pour
						activer la migration.
					</p>
				) : data.services.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Tous les services clients tournent sur {targetName}.
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Client</TableHead>
								<TableHead>Service</TableHead>
								<TableHead>Type</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.services.map((service) => (
								<TableRow key={service.serviceId}>
									<TableCell>{service.organizationName}</TableCell>
									<TableCell>
										<div className="font-medium">{service.name}</div>
										<div className="font-mono text-xs text-muted-foreground">
											{service.appName}
										</div>
									</TableCell>
									<TableCell>
										<Badge variant="outline">
											{TYPE_LABELS[service.serviceType]}
										</Badge>
									</TableCell>
									<TableCell className="text-right">
										<Button
											size="sm"
											variant="outline"
											disabled={running !== null}
											isLoading={running?.serviceId === service.serviceId}
											onClick={() => setConfirming(service)}
										>
											Migrer
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}

				{logs.length > 0 && (
					<pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
						{logs.join("\n")}
					</pre>
				)}
			</CardContent>

			<Dialog
				open={confirming !== null}
				onOpenChange={(open) => !open && setConfirming(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Migrer {confirming?.name} ?</DialogTitle>
						<DialogDescription>
							Le service de {confirming?.organizationName} sera arrêté le temps
							de copier ses volumes, puis redéployé sur {targetName}. Prévenez
							le client avant : s'il utilise son propre domaine, il devra le
							faire pointer vers {data?.target?.ipAddress}. Les données restent
							aussi sur le serveur du panel, en cas de retour arrière.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirming(null)}>
							Annuler
						</Button>
						<Button onClick={() => confirming && start(confirming)}>
							Lancer la migration
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
};
