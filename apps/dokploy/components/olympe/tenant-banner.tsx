import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { api } from "@/utils/api";
import { daysUntil, formatDay } from "./format";

const Bar = ({
	tone,
	children,
}: {
	tone: "info" | "warn" | "danger";
	children: React.ReactNode;
}) => {
	const colors = {
		info: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
		warn: "bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30",
		danger: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
	}[tone];
	return (
		<div
			className={`border-b px-4 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1 ${colors}`}
			data-no-translate
		>
			{children}
		</div>
	);
};

export const OlympeBanner = () => {
	const { data } = api.olympe.me.useQuery();
	const [sending, setSending] = useState(false);
	const tenant = data?.tenant;
	if (!tenant) return null;

	const email = "email" in data ? data.email : undefined;
	const unverified = "mustVerifyEmail" in data && data.mustVerifyEmail;
	const days = daysUntil(tenant.currentPeriodEnd);
	const billing = (
		<Link href="/dashboard/billing" className="font-medium underline">
			Facturation
		</Link>
	);

	const resend = async () => {
		if (!email) return;
		setSending(true);
		const { error } = await authClient.sendVerificationEmail({
			email,
			callbackURL: "/dashboard/projects",
		});
		setSending(false);
		if (error) toast.error(error.message ?? "Envoi impossible");
		else toast.success("E-mail de confirmation renvoyé");
	};

	return (
		<>
			{unverified && (
				<Bar tone="info">
					<span>
						Confirmez votre adresse e-mail ({email}) pour pouvoir déployer.
					</span>
					<button
						type="button"
						className="font-medium underline disabled:opacity-50"
						onClick={resend}
						disabled={sending}
					>
						Renvoyer l'e-mail
					</button>
				</Bar>
			)}
			{tenant.status === "suspended" && (
				<Bar tone="danger">
					<span>
						Votre espace est suspendu : vos applications sont en pause, vos
						données sont conservées.
					</span>
					{billing}
				</Bar>
			)}
			{tenant.status === "past_due" && (
				<Bar tone="danger">
					<span>
						Votre forfait est arrivé à échéance le{" "}
						{formatDay(tenant.currentPeriodEnd)}. Sans paiement, l'espace sera
						suspendu {tenant.graceDays} jours après.
					</span>
					{billing}
				</Bar>
			)}
			{tenant.status === "trial" && (
				<Bar tone={days <= 3 ? "warn" : "info"}>
					<span>
						Essai gratuit :{" "}
						{days > 0
							? `${days} jour${days > 1 ? "s" : ""} restant${days > 1 ? "s" : ""}`
							: "dernier jour"}
						.
					</span>
					{billing}
				</Bar>
			)}
			{tenant.status === "active" && days <= 7 && (
				<Bar tone="warn">
					<span>
						Votre forfait {tenant.plan.name} se termine le{" "}
						{formatDay(tenant.currentPeriodEnd)}.
					</span>
					{billing}
				</Bar>
			)}
		</>
	);
};
