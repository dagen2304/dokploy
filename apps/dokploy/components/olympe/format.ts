export const formatXaf = (amount: number, currency = "XAF") =>
	`${new Intl.NumberFormat("fr-FR").format(amount)} ${currency === "XAF" ? "FCFA" : currency}`;

export const formatDay = (value: Date | string) =>
	new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(
		new Date(value),
	);

export const formatMemoryMb = (mb: number) =>
	mb >= 1024
		? `${Math.round((mb / 1024) * 10) / 10} Go`
		: `${Math.round(mb)} Mo`;

export const formatBytes = (bytes: number) => {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} Go`;
	if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} Mo`;
	return `${Math.round(bytes / 1024)} Ko`;
};

export const daysUntil = (value: Date | string) =>
	Math.ceil((new Date(value).getTime() - Date.now()) / (24 * 60 * 60 * 1000));

export const STATUS_LABELS: Record<string, string> = {
	trial: "Essai",
	active: "Actif",
	past_due: "Échéance dépassée",
	suspended: "Suspendu",
};

export const METHOD_LABELS: Record<string, string> = {
	mtn_momo: "MTN Mobile Money",
	orange_money: "Orange Money",
	card: "Carte bancaire",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
	pending: "En attente",
	succeeded: "Payé",
	failed: "Échoué",
	canceled: "Annulé",
};

export const count = (
	value: number,
	singular: string,
	plural = `${singular}s`,
) => `${value} ${value > 1 ? plural : singular}`;
