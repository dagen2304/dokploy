import { Building2, CreditCard, type LucideIcon } from "lucide-react";

// Pages that act on the shared server: clients of a multi-tenant Olympe never
// see them (the API refuses them anyway).
export const CLIENT_HIDDEN_URLS = new Set([
	"/dashboard/monitoring",
	"/dashboard/sandboxes",
	"/dashboard/traefik",
	"/dashboard/docker",
	"/dashboard/requests",
	"/dashboard/settings/server",
	"/dashboard/settings/deployments",
	"/dashboard/settings/audit-logs",
	"/dashboard/settings/dns",
	"/dashboard/settings/certificates",
	"/dashboard/settings/billing",
	"/dashboard/settings/license",
	"/dashboard/settings/sso",
	"/dashboard/settings/whitelabeling",
	"/dashboard/settings/cluster",
]);

type MenuItem = {
	url?: string;
	isSingle?: boolean;
	items?: { url: string }[];
};

type OlympeMe =
	| { multiTenant: boolean; isOperator: boolean; tenant: unknown }
	| undefined;

export const OLYMPE_BILLING_ITEM = {
	isSingle: true as const,
	title: "Billing",
	url: "/dashboard/billing",
	icon: CreditCard as LucideIcon,
};

export const OLYMPE_OPERATOR_ITEM = {
	isSingle: true as const,
	title: "Olympe clients",
	url: "/dashboard/olympe",
	icon: Building2 as LucideIcon,
};

export const applyOlympeMenu = <T extends MenuItem>(
	items: T[],
	me: OlympeMe,
	extra: T[] = [],
): T[] => {
	if (!me?.multiTenant) return items;
	if (!me.tenant) return [...items, ...extra];
	const visible = items
		.filter((item) => !item.url || !CLIENT_HIDDEN_URLS.has(item.url))
		.map((item) =>
			item.items
				? {
						...item,
						items: item.items.filter((sub) => !CLIENT_HIDDEN_URLS.has(sub.url)),
					}
				: item,
		);
	return [...visible, ...extra];
};
