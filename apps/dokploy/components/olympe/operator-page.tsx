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
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api, type RouterOutputs } from "@/utils/api";
import {
	count,
	formatBytes,
	formatDay,
	formatMemoryMb,
	formatXaf,
	STATUS_LABELS,
} from "./format";
import { MigrationCard } from "./migration-card";

type Plan = RouterOutputs["olympe"]["operator"]["plans"][number];

const NUMBER_FIELDS = [
	["priceMonthly", "Prix mensuel"],
	["cpu", "vCPU"],
	["memoryMb", "RAM (Mo)"],
	["diskGb", "Disque (Go)"],
	["maxServices", "Services max"],
	["maxDatabases", "Bases max"],
	["maxDomains", "Domaines max"],
	["maxConcurrentBuilds", "Builds simultanés"],
	["maxMembers", "Membres max"],
	["aiDiagnosesPerMonth", "Diagnostics IA / mois"],
	["trialDays", "Jours d'essai"],
	["sortOrder", "Ordre d'affichage"],
] as const;

const EMPTY_PLAN = {
	slug: "",
	name: "",
	description: "",
	priceMonthly: 0,
	currency: "XAF",
	cpu: 1,
	memoryMb: 1024,
	diskGb: 10,
	maxServices: 5,
	maxDatabases: 2,
	maxDomains: 5,
	maxConcurrentBuilds: 1,
	maxMembers: 1,
	aiDiagnosesPerMonth: 10,
	isTrial: false,
	trialDays: 0,
	isPublic: true,
	active: true,
	sortOrder: 10,
};

const PlanDialog = ({
	plan,
	onClose,
}: {
	plan: Partial<Plan> | null;
	onClose: () => void;
}) => {
	const utils = api.useUtils();
	const save = api.olympe.operator.savePlan.useMutation();
	const [draft, setDraft] = useState({ ...EMPTY_PLAN, ...(plan ?? {}) });
	if (!plan) return null;

	const submit = async () => {
		try {
			await save.mutateAsync({
				planId: draft.planId,
				slug: draft.slug,
				name: draft.name,
				description: draft.description ?? "",
				priceMonthly: Number(draft.priceMonthly),
				currency: draft.currency,
				cpu: Number(draft.cpu),
				memoryMb: Number(draft.memoryMb),
				diskGb: Number(draft.diskGb),
				maxServices: Number(draft.maxServices),
				maxDatabases: Number(draft.maxDatabases),
				maxDomains: Number(draft.maxDomains),
				maxConcurrentBuilds: Number(draft.maxConcurrentBuilds),
				maxMembers: Number(draft.maxMembers),
				aiDiagnosesPerMonth: Number(draft.aiDiagnosesPerMonth),
				isTrial: draft.isTrial,
				trialDays: Number(draft.trialDays),
				isPublic: draft.isPublic,
				active: draft.active,
				sortOrder: Number(draft.sortOrder),
			});
			await utils.olympe.operator.plans.invalidate();
			toast.success("Forfait enregistré");
			onClose();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Enregistrement impossible",
			);
		}
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-w-2xl" data-no-translate>
				<DialogHeader>
					<DialogTitle>
						{draft.planId ? `Modifier ${draft.name}` : "Nouveau forfait"}
					</DialogTitle>
				</DialogHeader>
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="flex flex-col gap-1.5">
						<Label>Nom</Label>
						<Input
							value={draft.name}
							onChange={(e) => setDraft({ ...draft, name: e.target.value })}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label>Identifiant (slug)</Label>
						<Input
							value={draft.slug}
							onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
						/>
					</div>
					<div className="flex flex-col gap-1.5 sm:col-span-2">
						<Label>Description</Label>
						<Input
							value={draft.description ?? ""}
							onChange={(e) =>
								setDraft({ ...draft, description: e.target.value })
							}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label>Devise</Label>
						<Input
							value={draft.currency}
							onChange={(e) =>
								setDraft({ ...draft, currency: e.target.value.toUpperCase() })
							}
						/>
					</div>
					{NUMBER_FIELDS.map(([key, label]) => (
						<div key={key} className="flex flex-col gap-1.5">
							<Label>{label}</Label>
							<Input
								type="number"
								step={key === "cpu" ? "0.25" : "1"}
								value={String(draft[key] ?? 0)}
								onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
							/>
						</div>
					))}
					{(
						[
							["isTrial", "Forfait d'essai"],
							["isPublic", "Visible des clients"],
							["active", "Actif"],
						] as const
					).map(([key, label]) => (
						<div key={key} className="flex items-center gap-2">
							<Switch
								checked={Boolean(draft[key])}
								onCheckedChange={(value) =>
									setDraft({ ...draft, [key]: value })
								}
							/>
							<Label>{label}</Label>
						</div>
					))}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Annuler
					</Button>
					<Button onClick={submit} disabled={save.isPending}>
						Enregistrer
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

export const OperatorPage = () => {
	const utils = api.useUtils();
	const { data: me } = api.olympe.me.useQuery();
	const { data: tenants } = api.olympe.operator.tenants.useQuery();
	const { data: plans } = api.olympe.operator.plans.useQuery();
	const { data: revenue } = api.olympe.operator.revenue.useQuery();
	const setPlan = api.olympe.operator.setPlan.useMutation();
	const offer = api.olympe.operator.offerMonths.useMutation();
	const suspend = api.olympe.operator.suspend.useMutation();
	const reactivate = api.olympe.operator.reactivate.useMutation();
	const cycle = api.olympe.operator.runBillingCycle.useMutation();
	const disk = api.olympe.operator.measureDisk.useMutation();
	const isolate = api.olympe.operator.isolateExisting.useMutation();
	const [editing, setEditing] = useState<Partial<Plan> | null>(null);

	const act = async (action: () => Promise<unknown>, success: string) => {
		try {
			await action();
			await utils.olympe.operator.tenants.invalidate();
			toast.success(success);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Action impossible");
		}
	};

	if (me && !me.multiTenant) {
		return (
			<Card data-no-translate>
				<CardHeader>
					<CardTitle>Mode multi-client désactivé</CardTitle>
					<CardDescription>
						Définissez OLYMPE_OPERATOR_ORG_ID sur le service dokploy pour
						accueillir des clients.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const money = (values?: Record<string, number>) =>
		values && Object.keys(values).length > 0
			? Object.entries(values)
					.map(([currency, amount]) => formatXaf(amount, currency))
					.join(" · ")
			: formatXaf(0);

	return (
		<div className="flex flex-col gap-4 w-full" data-no-translate>
			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader>
						<CardDescription>Encaissé ce mois</CardDescription>
						<CardTitle>{money(revenue?.thisMonth)}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>Encaissé au total</CardDescription>
						<CardTitle>{money(revenue?.total)}</CardTitle>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardDescription>Clients</CardDescription>
						<CardTitle>{tenants?.length ?? 0}</CardTitle>
						{revenue && revenue.simulated > 0 && (
							<p className="text-xs text-muted-foreground">
								dont {revenue.simulated} paiement
								{revenue.simulated > 1 ? "s" : ""} simulé
								{revenue.simulated > 1 ? "s" : ""}
							</p>
						)}
					</CardHeader>
				</Card>
			</div>

			<Card>
				<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
					<div className="flex flex-col gap-1.5">
						<CardTitle>Espaces clients</CardTitle>
						<CardDescription>
							Le cycle de facturation et la mesure du disque tournent toutes les
							heures.
						</CardDescription>
					</div>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={cycle.isPending}
							onClick={() =>
								act(() => cycle.mutateAsync(), "Cycle de facturation exécuté")
							}
						>
							Lancer la facturation
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={disk.isPending}
							onClick={() => act(() => disk.mutateAsync(), "Disque mesuré")}
						>
							Mesurer le disque
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={isolate.isPending}
							onClick={() =>
								act(async () => {
									const report = await isolate.mutateAsync();
									const moved = report.reduce(
										(sum, row) => sum + row.moved.length,
										0,
									);
									const failed = report.reduce(
										(sum, row) => sum + row.failed.length,
										0,
									);
									const composes = report.flatMap(
										(row) => row.composesToRedeploy,
									);
									toast.message(
										`${moved} service(s) isolé(s), ${failed} échec(s)${composes.length ? ` · à redéployer : ${composes.join(", ")}` : ""}`,
									);
								}, "Isolation terminée")
							}
						>
							Isoler les services existants
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Espace</TableHead>
								<TableHead>Forfait</TableHead>
								<TableHead>Statut</TableHead>
								<TableHead>Échéance</TableHead>
								<TableHead>Utilisation</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{tenants?.map((tenant) => (
								<TableRow key={tenant.organizationId}>
									<TableCell>
										<div className="font-medium">{tenant.name}</div>
										<div className="text-xs text-muted-foreground">
											{tenant.ownerEmail}
										</div>
									</TableCell>
									<TableCell>
										<Select
											value={tenant.plan.planId}
											onValueChange={(planId) =>
												act(
													() =>
														setPlan.mutateAsync({
															organizationId: tenant.organizationId,
															planId,
														}),
													"Forfait modifié",
												)
											}
										>
											<SelectTrigger className="w-36">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{plans?.map((plan) => (
													<SelectItem key={plan.planId} value={plan.planId}>
														{plan.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</TableCell>
									<TableCell>
										<div className="flex flex-col gap-1">
											<Badge
												variant={
													tenant.status === "suspended" ||
													tenant.status === "past_due"
														? "destructive"
														: "secondary"
												}
											>
												{STATUS_LABELS[tenant.status] ?? tenant.status}
											</Badge>
											{tenant.toDelete && (
												<Badge variant="outline">À supprimer</Badge>
											)}
										</div>
									</TableCell>
									<TableCell>{formatDay(tenant.currentPeriodEnd)}</TableCell>
									<TableCell className="text-xs">
										{formatMemoryMb(tenant.usage.memoryMb)} /{" "}
										{formatMemoryMb(tenant.plan.memoryMb)} RAM
										<br />
										{count(tenant.usage.services, "service")} ·{" "}
										{count(tenant.usage.databases, "base")} ·{" "}
										{formatBytes(tenant.usage.diskBytes)}
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												onClick={() =>
													act(
														() =>
															offer.mutateAsync({
																organizationId: tenant.organizationId,
																months: 1,
															}),
														"Un mois offert",
													)
												}
											>
												+1 mois
											</Button>
											{tenant.status === "suspended" ? (
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														act(
															() =>
																reactivate.mutateAsync({
																	organizationId: tenant.organizationId,
																}),
															"Espace réactivé",
														)
													}
												>
													Réactiver
												</Button>
											) : (
												<Button
													variant="ghost"
													size="sm"
													onClick={() =>
														act(
															() =>
																suspend.mutateAsync({
																	organizationId: tenant.organizationId,
																}),
															"Espace suspendu",
														)
													}
												>
													Suspendre
												</Button>
											)}
										</div>
									</TableCell>
								</TableRow>
							))}
							{tenants?.length === 0 && (
								<TableRow>
									<TableCell
										colSpan={6}
										className="text-center text-muted-foreground"
									>
										Aucun client pour le moment.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
					<div className="flex flex-col gap-1.5">
						<CardTitle>Forfaits</CardTitle>
						<CardDescription>
							Prix et limites modifiables à tout moment.
						</CardDescription>
					</div>
					<Button size="sm" onClick={() => setEditing({})}>
						Nouveau forfait
					</Button>
				</CardHeader>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Forfait</TableHead>
								<TableHead>Prix / mois</TableHead>
								<TableHead>Ressources</TableHead>
								<TableHead>Limites</TableHead>
								<TableHead>État</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{plans?.map((plan) => (
								<TableRow key={plan.planId}>
									<TableCell className="font-medium">{plan.name}</TableCell>
									<TableCell>
										{plan.isTrial
											? `Essai ${plan.trialDays} j`
											: formatXaf(plan.priceMonthly, plan.currency)}
									</TableCell>
									<TableCell className="text-xs">
										{plan.cpu} vCPU · {formatMemoryMb(plan.memoryMb)} ·{" "}
										{plan.diskGb} Go
									</TableCell>
									<TableCell className="text-xs">
										{count(plan.maxServices, "service")} ·{" "}
										{count(plan.maxDatabases, "base")} ·{" "}
										{count(plan.maxDomains, "domaine")} ·{" "}
										{count(plan.maxMembers, "membre")}
									</TableCell>
									<TableCell>
										{!plan.active
											? "Désactivé"
											: plan.isPublic
												? "Public"
												: "Masqué"}
									</TableCell>
									<TableCell className="text-right">
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setEditing(plan)}
										>
											Modifier
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<MigrationCard />

			{editing && (
				<PlanDialog plan={editing} onClose={() => setEditing(null)} />
			)}
		</div>
	);
};
