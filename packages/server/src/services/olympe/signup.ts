import { db } from "@dokploy/server/db";
import { member, olympeSignup, organization } from "@dokploy/server/db/schema";
import { sendEmail } from "@dokploy/server/verification/send-verification-email";
import { and, count, eq, gte } from "drizzle-orm";
import { getOlympeConfig } from "./config";
import { ensureTenantNetwork } from "./network";
import { getTenant } from "./tenants";

const DISPOSABLE_DOMAINS = [
	"mailinator.com",
	"yopmail.com",
	"yopmail.fr",
	"guerrillamail.com",
	"sharklasers.com",
	"10minutemail.com",
	"temp-mail.org",
	"tempmail.com",
	"tempmail.net",
	"trashmail.com",
	"getnada.com",
	"dispostable.com",
	"maildrop.cc",
	"mohmal.com",
	"throwawaymail.com",
	"fakeinbox.com",
	"mintemail.com",
	"emailondeck.com",
];

export const clientIpFrom = (headers?: Headers | null) => {
	if (!headers) return "unknown";
	return (
		headers.get("cf-connecting-ip") ??
		headers.get("x-real-ip") ??
		headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		"unknown"
	);
};

export const isDisposableEmail = (email: string, extra: string[] = []) => {
	const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
	return [...DISPOSABLE_DOMAINS, ...extra].some(
		(blocked) => domain === blocked || domain.endsWith(`.${blocked}`),
	);
};

const verifyTurnstile = async (token: string | null, ip: string) => {
	const { turnstileSecretKey } = getOlympeConfig();
	if (!turnstileSecretKey) return true;
	if (!token) return false;
	try {
		const response = await fetch(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify",
			{
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					secret: turnstileSecretKey,
					response: token,
					...(ip !== "unknown" ? { remoteip: ip } : {}),
				}),
			},
		);
		const result = (await response.json()) as { success?: boolean };
		return result.success === true;
	} catch (error) {
		console.error("[olympe] turnstile", error);
		return false;
	}
};

// Returns the refusal message, or null when the self-service sign-up may go on.
export const checkSelfSignup = async (
	email: string,
	headers?: Headers | null,
): Promise<string | null> => {
	const config = getOlympeConfig();
	if (!config.publicSignup) return "Les inscriptions sont fermées.";
	if (isDisposableEmail(email, config.blockedEmailDomains)) {
		return "Les adresses e-mail jetables ne sont pas acceptées.";
	}
	const ip = clientIpFrom(headers);
	if (!(await verifyTurnstile(headers?.get("x-turnstile-token") ?? null, ip))) {
		return "La vérification anti-robot a échoué, réessayez.";
	}
	if (ip !== "unknown" && config.signupsPerIpPerDay > 0) {
		const [row] = await db
			.select({ value: count() })
			.from(olympeSignup)
			.where(
				and(
					eq(olympeSignup.ip, ip),
					gte(
						olympeSignup.createdAt,
						new Date(Date.now() - 24 * 60 * 60 * 1000),
					),
				),
			);
		if (Number(row?.value ?? 0) >= config.signupsPerIpPerDay) {
			return "Trop d'inscriptions depuis cette connexion aujourd'hui, réessayez demain.";
		}
	}
	return null;
};

export const isSelfSignupRequest = (
	context:
		| {
				path?: string;
				request?: { headers?: Headers } | null;
		  }
		| null
		| undefined,
) =>
	getOlympeConfig().publicSignup &&
	!context?.path?.includes("/sso") &&
	!context?.path?.includes("/scim") &&
	!context?.request?.headers?.get("x-dokploy-token");

// Creates the client's own organization, plan and network right after sign-up.
export const createClientSpace = async (
	user: { id: string; name?: string | null; email: string },
	headers?: Headers | null,
) => {
	const firstName = user.name?.trim() || user.email.split("@")[0] || "client";
	const created = await db.transaction(async (tx) => {
		const [org] = await tx
			.insert(organization)
			.values({
				name: `Espace de ${firstName}`,
				ownerId: user.id,
				createdAt: new Date(),
			})
			.returning();
		if (!org) throw new Error("Organisation non créée");
		await tx.insert(member).values({
			userId: user.id,
			organizationId: org.id,
			role: "owner",
			createdAt: new Date(),
			isDefault: true,
		});
		await tx.insert(olympeSignup).values({
			email: user.email,
			ip: clientIpFrom(headers),
		});
		return org;
	});

	await getTenant(created.id);
	ensureTenantNetwork(created.id).catch((error) =>
		console.error("[olympe] tenant network", error),
	);
	return created;
};

export const sendOlympeVerificationEmail = async (
	user: { name?: string | null; email: string },
	url: string,
) => {
	const name = user.name?.trim() || "";
	await sendEmail({
		email: user.email,
		subject: "Olympe — confirmez votre adresse e-mail",
		text: `<p>Bonjour ${name},</p>
<p>Bienvenue sur Olympe ! Confirmez votre adresse e-mail pour pouvoir déployer vos applications :</p>
<p><a href="${url}">Confirmer mon adresse e-mail</a></p>
<p>Si vous n'avez pas créé de compte, ignorez ce message.</p>`,
	});
};

export const hasSelfSignedUp = async (email: string) =>
	Boolean(
		await db.query.olympeSignup.findFirst({
			where: eq(olympeSignup.email, email),
		}),
	);
