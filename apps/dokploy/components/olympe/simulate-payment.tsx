import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/utils/api";
import {
	formatDay,
	formatXaf,
	METHOD_LABELS,
	PAYMENT_STATUS_LABELS,
} from "./format";

// Stand-in for the aggregator's hosted payment page while OLYMPE_PAYMENT_PROVIDER
// is "simulated": the buttons call the same completion path a real webhook will.
export const SimulatePayment = () => {
	const router = useRouter();
	const paymentId =
		typeof router.query.payment === "string" ? router.query.payment : "";
	const utils = api.useUtils();
	const { data: payment, refetch } = api.olympe.payment.useQuery(
		{ paymentId },
		{ enabled: Boolean(paymentId) },
	);
	const simulate = api.olympe.simulatePayment.useMutation();
	const [phone, setPhone] = useState("");

	if (!payment) return null;

	const run = async (outcome: "succeeded" | "failed" | "canceled") => {
		try {
			await simulate.mutateAsync({ paymentId, outcome });
			await Promise.all([
				refetch(),
				utils.olympe.me.invalidate(),
				utils.olympe.payments.invalidate(),
			]);
			if (outcome === "succeeded")
				toast.success("Paiement confirmé, votre forfait est prolongé.");
			else toast.message("Paiement non abouti.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Échec");
		}
	};

	const isMobileMoney = payment.method !== "card";
	const done = payment.status !== "pending";

	return (
		<Card className="max-w-lg w-full mx-auto" data-no-translate>
			<CardHeader>
				<CardTitle>
					Paiement {METHOD_LABELS[payment.method] ?? payment.method}
				</CardTitle>
				<CardDescription>
					Page de test : elle remplace la page du prestataire de paiement tant
					que le paiement réel n'est pas branché.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="rounded-md border p-3 text-sm">
					<div className="flex justify-between">
						<span>Forfait</span>
						<span className="font-medium">
							{payment.plan.name} · {payment.months} mois
						</span>
					</div>
					<div className="flex justify-between">
						<span>Montant</span>
						<span className="font-semibold">
							{formatXaf(payment.amount, payment.currency)}
						</span>
					</div>
					<div className="flex justify-between">
						<span>Statut</span>
						<span>
							{PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
						</span>
					</div>
					{payment.paidAt && (
						<div className="flex justify-between">
							<span>Payé le</span>
							<span>{formatDay(payment.paidAt)}</span>
						</div>
					)}
				</div>

				{!done && isMobileMoney && (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="phone">
							Numéro Mobile Money (simulation, non utilisé)
						</Label>
						<Input
							id="phone"
							inputMode="tel"
							placeholder="6XX XX XX XX"
							value={phone}
							onChange={(event) => setPhone(event.target.value)}
						/>
					</div>
				)}

				{!done ? (
					<div className="flex flex-wrap gap-2">
						<Button
							onClick={() => run("succeeded")}
							disabled={simulate.isPending}
						>
							Simuler un paiement réussi
						</Button>
						<Button
							variant="outline"
							onClick={() => run("failed")}
							disabled={simulate.isPending}
						>
							Simuler un échec
						</Button>
						<Button
							variant="ghost"
							onClick={() => run("canceled")}
							disabled={simulate.isPending}
						>
							Annuler
						</Button>
					</div>
				) : (
					<Button asChild>
						<Link href="/dashboard/billing">Retour à la facturation</Link>
					</Button>
				)}
			</CardContent>
		</Card>
	);
};
