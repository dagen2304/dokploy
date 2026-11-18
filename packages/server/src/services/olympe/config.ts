type Env = Record<string, string | undefined>;

const list = (value: string | undefined) =>
	(value ?? "")
		.split(",")
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);

const int = (value: string | undefined, fallback: number) => {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const flag = (value: string | undefined) =>
	["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());

const DEFAULT_RESERVED_SUBDOMAINS = [
	"panel",
	"www",
	"api",
	"admin",
	"app",
	"apps",
	"up",
	"mail",
	"smtp",
	"imap",
	"pop",
	"ftp",
	"ns1",
	"ns2",
	"status",
	"billing",
	"support",
	"docs",
];

const parentDomain = (host: string) => {
	const labels = host.split(".");
	return labels.length > 2 ? labels.slice(1).join(".") : host;
};

export const getOlympeConfig = (env: Env = process.env) => {
	const operatorOrgId = env.OLYMPE_OPERATOR_ORG_ID?.trim() || null;
	const operatorAppsDomain =
		env.APPS_WILDCARD_DOMAIN?.trim().toLowerCase().replace(/^\*\./, "") || null;
	const tenantAppsDomain =
		env.OLYMPE_TENANT_APPS_DOMAIN?.trim().toLowerCase().replace(/^\*\./, "") ||
		operatorAppsDomain;
	const protectedDomains = list(env.OLYMPE_PROTECTED_DOMAINS);
	if (protectedDomains.length === 0 && operatorAppsDomain) {
		protectedDomains.push(parentDomain(operatorAppsDomain));
	}

	return {
		multiTenant: Boolean(operatorOrgId),
		operatorOrgId,
		tenantAppsDomain,
		protectedDomains,
		reservedSubdomains: env.OLYMPE_RESERVED_SUBDOMAINS
			? list(env.OLYMPE_RESERVED_SUBDOMAINS)
			: DEFAULT_RESERVED_SUBDOMAINS,
		allowPublishedPorts: flag(env.OLYMPE_TENANT_ALLOW_PUBLISHED_PORTS),
		publicSignup: Boolean(operatorOrgId) && flag(env.OLYMPE_PUBLIC_SIGNUP),
		defaultPlanSlug: env.OLYMPE_DEFAULT_PLAN?.trim() || "essai",
		graceDays: int(env.OLYMPE_GRACE_DAYS, 3),
		deleteAfterDays: int(env.OLYMPE_DELETE_AFTER_DAYS, 30),
		reminderDays: (env.OLYMPE_REMINDER_DAYS
			? list(env.OLYMPE_REMINDER_DAYS).map(Number)
			: [7, 3, 1]
		)
			.filter((day) => Number.isFinite(day) && day > 0)
			.sort((a, b) => b - a),
		annualFreeMonths: int(env.OLYMPE_ANNUAL_FREE_MONTHS, 2),
		paymentProvider: env.OLYMPE_PAYMENT_PROVIDER?.trim() || "simulated",
		signupsPerIpPerDay: int(env.OLYMPE_SIGNUPS_PER_IP_PER_DAY, 3),
		blockedEmailDomains: list(env.OLYMPE_BLOCKED_EMAIL_DOMAINS),
		turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() || null,
		turnstileSecretKey: env.TURNSTILE_SECRET_KEY?.trim() || null,
		abuseEmail: env.OLYMPE_ABUSE_EMAIL?.trim() || null,
		termsUrl: env.OLYMPE_TERMS_URL?.trim() || null,
		privacyUrl: env.OLYMPE_PRIVACY_URL?.trim() || null,
		suspendedPageUrl: env.OLYMPE_SUSPENDED_URL?.trim() || null,
		defaultServiceCpu:
			Number.parseFloat(env.OLYMPE_DEFAULT_SERVICE_CPU ?? "") || 0.5,
		defaultServiceMemoryMb: int(env.OLYMPE_DEFAULT_SERVICE_MEMORY_MB, 512),
		diskWarnPercent: int(env.OLYMPE_DISK_WARN_PERCENT, 80),
		// Without SMTP nobody could ever confirm their address.
		emailVerificationRequired:
			Boolean(env.SMTP_SERVER?.trim()) &&
			!flag(env.OLYMPE_SKIP_EMAIL_VERIFICATION),
		buildConcurrencyEnforced: !flag(env.OLYMPE_DISABLE_BUILD_QUEUE),
	};
};

export type OlympeConfig = ReturnType<typeof getOlympeConfig>;
