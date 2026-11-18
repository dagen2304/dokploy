import { useRouter } from "next/router";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api } from "@/utils/api";
import {
	count,
	formatDay,
	formatMemoryMb,
	formatXaf,
	METHOD_LABELS,
	PAYMENT_STATUS_LABELS,
	STATUS_LABELS,
} from "./format";
import { UsageGauges } from "./usage-gauges";

const statusVariant = (status: string) =>
	status === "suspended" || status === "past_due" ? "destructive" : "secondary";

export const BillingPage = () => {
	const router = useRouter();
	const utils = api.useUtils();
	const { data: me } = api.olympe.me.useQuery();
	const { data: options } = api.olympe.billingOptions.useQuery();
	const { data: payments } = api.olympe.payments.useQuery();
	const { data: auth } = api.user.get.useQuery();
	const checkout = api.olympe.checkout.useMutation();

	const [months, setMonths] = useState(1);
	const [planId, setPlanId] = useState<string | null>(null);
	const [method, setMethod] = useState<string>("mtn_momo");

	const tenant = me?.tenant;
	if (!me) return null;
	if (!tenant) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Facturation</CardTitle>
					<CardDescription>
						Cette organisation est celle de l'opérateur : elle ne paie pas de
						forfait.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const canPay = auth?.role === "owner" || auth?.role === "admin";
	const selectedPlan =
		options?.plans.find(
			(plan) => plan.planId === (planId ?? tenant.plan.planId),
		) ?? options?.plans[0];
	const amount = selectedPlan
		? (selectedPlan.prices as Record<string, number>)[String(months)]
		: 0;

	const pay = async () => {
		if (!selectedPlan) return;
		try {
			const result = await checkout.mutateAsync({
				planId: selectedPlan.planId,
				months,
				method: method as "mtn_momo" | "orange_money" | "card",
			});
			await router.push(result.redirectUrl);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Paiement impossible",
			);
		}
	};

	const openInvoice = async (paymentId: string) => {
		try {
			const html = await utils.olympe.invoice.fetch({ paymentId });
			const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
			window.open(url, "_blank", "noopener");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Facture indisponible",
			);
		}
	};

	return (
		<div className="flex flex-col gap-4 w-full" data-no-translate>
			<Card>
				<CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
					<div className="flex flex-col gap-1.5">
						<CardTitle className="flex items-center gap-2">
							Forfait {tenant.plan.name}
							<Badge variant={statusVariant(tenant.status)}>
								{STATUS_LABELS[tenant.status] ?? tenant.status}
							</Badge>
						</CardTitle>
						<CardDescription>
							{tenant.status === "trial"
								? "Essai jusqu'au "
								: "Actif jusqu'au "}
							{formatDay(tenant.currentPeriodEnd)}
							{tenant.plan.priceMonthly > 0 &&
								` · ${formatXaf(tenant.plan.priceMonthly, tenant.plan.currency)} par mois`}
						</CardDescription>
					</div>
				</CardHeader>
				<CardContent>
					{me.usage && <UsageGauges plan={tenant.plan} usage={me.usage} />}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Choisir, changer ou renouveler un forfait</CardTitle>
					<CardDescription>
						Le paiement prolonge votre espace. Si vous changez de forfait, les
						jours restants sont convertis au prix du nouveau forfait.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-5">
					{options?.simulated && (
						<div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
							Mode test : les paiements sont simulés, aucun argent n'est
							prélevé.
						</div>
					)}

					<div className="flex flex-wrap gap-2">
						{options?.durations.map((value) => (
							<Button
								key={value}
								variant={months === value ? "default" : "outline"}
								size="sm"
								onClick={() => setMonths(value)}
							>
								{value} mois
								{value >= 12 &&
									options.annualFreeMonths > 0 &&
									` · ${options.annualFreeMonths} offerts`}
							</Button>
						))}
					</div>

					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						{options?.plans.map((plan) => {
							const selected = plan.planId === selectedPlan?.planId;
							return (
								<button
									type="button"
									key={plan.planId}
									onClick={() => setPlanId(plan.planId)}
									className={`rounded-lg border p-4 text-left transition-colors ${selected ? "border-primary ring-2 ring-primary/30" : "hover:border-foreground/30"}`}
								>
									<div className="flex items-center justify-between">
										<span className="font-semibold">{plan.name}</span>
										{plan.planId === tenant.plan.planId && (
											<Badge variant="outline">Actuel</Badge>
										)}
									</div>
									<div className="mt-1 text-xl font-semibold">
										{formatXaf(
											(plan.prices as Record<string, number>)[String(months)] ??
												0,
											plan.currency,
										)}
									</div>
									<div className="text-xs text-muted-foreground">
										pour {months} mois ·{" "}
										{formatXaf(plan.priceMonthly, plan.currency)}/mois
									</div>
									<p className="mt-2 text-sm text-muted-foreground">
										{plan.description}
									</p>
									<ul className="mt-3 space-y-1 text-sm">
										<li>
											{plan.cpu} vCPU · {formatMemoryMb(plan.memoryMb)} de RAM
										</li>
										<li>{plan.diskGb} Go de disque</li>
										<li>
											{count(plan.maxServices, "service")} ·{" "}
											{count(plan.maxDatabases, "base")}
										</li>
										<li>
											{count(plan.maxDomains, "domaine")} ·{" "}
											{count(plan.maxMembers, "membre")}
										</li>
										<li>{plan.aiDiagnosesPerMonth} diagnostics IA par mois</li>
									</ul>
								</button>
							);
						})}
					</div>

					<div className="flex flex-col gap-2">
						<span className="text-sm font-medium">Moyen de paiement</span>
						<div className="flex flex-wrap gap-2">
							{options?.methods.map((item) => (
								<Button
									key={item.id}
									variant={method === item.id ? "default" : "outline"}
									size="sm"
									onClick={() => setMethod(item.id)}
								>
									{item.label}
								</Button>
							))}
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-3">
						<Button
							onClick={pay}
							disabled={!canPay || !selectedPlan || checkout.isPending}
						>
							{checkout.isPending
								? "Préparation…"
								: `Payer ${formatXaf(amount ?? 0, selectedPlan?.currency)}`}
						</Button>
						{!canPay && (
							<span className="text-sm text-muted-foreground">
								Seuls le propriétaire et les administrateurs de l'espace peuvent
								payer.
							</span>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Historique des paiements</CardTitle>
				</CardHeader>
				<CardContent>
					{payments && payments.length > 0 ? (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Date</TableHead>
									<TableHead>Forfait</TableHead>
									<TableHead>Moyen</TableHead>
									<TableHead>Montant</TableHead>
									<TableHead>Statut</TableHead>
									<TableHead />
								</TableRow>
							</TableHeader>
							<TableBody>
								{payments.map((payment) => (
									<TableRow key={payment.paymentId}>
										<TableCell>
											{formatDay(payment.paidAt ?? payment.createdAt)}
										</TableCell>
										<TableCell>
											{payment.plan.name} · {payment.months} mois
										</TableCell>
										<TableCell>
											{METHOD_LABELS[payment.method] ?? payment.method}
										</TableCell>
										<TableCell>
											{formatXaf(payment.amount, payment.currency)}
										</TableCell>
										<TableCell>
											{PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
											{payment.provider === "simulated" && " (test)"}
										</TableCell>
										<TableCell className="text-right">
											{payment.invoiceNumber && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => openInvoice(payment.paymentId)}
												>
													Facture {payment.invoiceNumber}
												</Button>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					) : (
						<p className="text-sm text-muted-foreground">
							Aucun paiement pour le moment.
						</p>
					)}
				</CardContent>
			</Card>
		</div>
	);
};
