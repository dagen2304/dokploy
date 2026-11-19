import { validateRequest } from "@dokploy/server";
import { getOlympeConfig } from "@dokploy/server/services/olympe/config";
import type { GetServerSidePropsContext } from "next";
import Link from "next/link";
import { useRouter } from "next/router";
import Script from "next/script";
import {
	type FormEvent,
	type ReactElement,
	useEffect,
	useRef,
	useState,
} from "react";
import { OnboardingLayout } from "@/components/layouts/onboarding-layout";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Props = {
	turnstileSiteKey: string | null;
	termsUrl: string | null;
	privacyUrl: string | null;
};

declare global {
	interface Window {
		turnstile?: {
			render: (
				element: HTMLElement,
				options: {
					sitekey: string;
					callback: (token: string) => void;
					language?: string;
				},
			) => string;
			reset: (id?: string) => void;
		};
	}
}

const Turnstile = ({
	siteKey,
	onToken,
}: {
	siteKey: string;
	onToken: (token: string) => void;
}) => {
	const ref = useRef<HTMLDivElement>(null);
	const [ready, setReady] = useState(false);
	useEffect(() => {
		if (!ready || !ref.current || !window.turnstile) return;
		ref.current.innerHTML = "";
		window.turnstile.render(ref.current, {
			sitekey: siteKey,
			callback: onToken,
			language: "fr",
		});
	}, [ready, siteKey, onToken]);
	return (
		<>
			<Script
				src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
				onReady={() => setReady(true)}
			/>
			<div ref={ref} />
		</>
	);
};

export default function Signup({
	turnstileSiteKey,
	termsUrl,
	privacyUrl,
}: Props) {
	const router = useRouter();
	const [form, setForm] = useState({
		firstName: "",
		lastName: "",
		email: "",
		password: "",
		confirm: "",
	});
	const [accepted, setAccepted] = useState(false);
	const [token, setToken] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const update =
		(key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
			setForm({ ...form, [key]: event.target.value });

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setError(null);
		if (form.password.length < 8)
			return setError("Le mot de passe doit faire au moins 8 caractères.");
		if (form.password !== form.confirm)
			return setError("Les deux mots de passe ne correspondent pas.");
		if (!accepted)
			return setError("Acceptez les conditions d'utilisation pour continuer.");
		if (turnstileSiteKey && !token)
			return setError("Validez la vérification anti-robot.");

		setLoading(true);
		const { error: signupError } = await authClient.signUp.email({
			email: form.email.trim(),
			password: form.password,
			name: form.firstName.trim(),
			callbackURL: "/dashboard/home",
			lastName: form.lastName.trim(),
			fetchOptions: token
				? { headers: { "x-turnstile-token": token } }
				: undefined,
		});
		setLoading(false);
		if (signupError) {
			setError(signupError.message ?? "Inscription impossible, réessayez.");
			return;
		}
		await router.push("/dashboard/home");
	};

	return (
		<CardContent className="flex flex-col gap-6 p-6" data-no-translate>
			<div className="flex flex-col items-center gap-2 text-center">
				<Logo className="size-12" />
				<CardTitle className="text-2xl">Créer votre espace Olympe</CardTitle>
				<CardDescription>
					14 jours d'essai gratuit, sans carte bancaire. Déployez vos
					applications en quelques minutes.
				</CardDescription>
			</div>
			<form onSubmit={submit} className="flex flex-col gap-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="firstName">Prénom</Label>
						<Input
							id="firstName"
							required
							value={form.firstName}
							onChange={update("firstName")}
							autoComplete="given-name"
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="lastName">Nom</Label>
						<Input
							id="lastName"
							required
							value={form.lastName}
							onChange={update("lastName")}
							autoComplete="family-name"
						/>
					</div>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="email">Adresse e-mail</Label>
					<Input
						id="email"
						type="email"
						required
						value={form.email}
						onChange={update("email")}
						autoComplete="email"
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="password">Mot de passe</Label>
					<Input
						id="password"
						type="password"
						required
						value={form.password}
						onChange={update("password")}
						autoComplete="new-password"
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="confirm">Confirmer le mot de passe</Label>
					<Input
						id="confirm"
						type="password"
						required
						value={form.confirm}
						onChange={update("confirm")}
						autoComplete="new-password"
					/>
				</div>
				<div className="flex items-start gap-2 text-sm">
					<Checkbox
						id="terms"
						checked={accepted}
						onCheckedChange={(value) => setAccepted(value === true)}
					/>
					<label htmlFor="terms" className="leading-snug">
						J'accepte les{" "}
						{termsUrl ? (
							<a
								href={termsUrl}
								target="_blank"
								rel="noreferrer"
								className="underline"
							>
								conditions d'utilisation
							</a>
						) : (
							"conditions d'utilisation"
						)}{" "}
						et la{" "}
						{privacyUrl ? (
							<a
								href={privacyUrl}
								target="_blank"
								rel="noreferrer"
								className="underline"
							>
								politique de confidentialité
							</a>
						) : (
							"politique de confidentialité"
						)}
						.
					</label>
				</div>
				{turnstileSiteKey && (
					<Turnstile siteKey={turnstileSiteKey} onToken={setToken} />
				)}
				{error && <p className="text-sm text-red-500">{error}</p>}
				<Button type="submit" disabled={loading}>
					{loading ? "Création…" : "Créer mon espace"}
				</Button>
			</form>
			<p className="text-center text-sm text-muted-foreground">
				Déjà un compte ?{" "}
				<Link href="/" className="underline">
					Se connecter
				</Link>
			</p>
		</CardContent>
	);
}

Signup.getLayout = (page: ReactElement) => (
	<OnboardingLayout>{page}</OnboardingLayout>
);

export async function getServerSideProps(context: GetServerSidePropsContext) {
	const config = getOlympeConfig();
	if (!config.publicSignup) {
		return { redirect: { permanent: false, destination: "/" } };
	}
	const { user } = await validateRequest(context.req);
	if (user) {
		return { redirect: { permanent: false, destination: "/dashboard/home" } };
	}
	return {
		props: {
			turnstileSiteKey: config.turnstileSiteKey,
			termsUrl: config.termsUrl,
			privacyUrl: config.privacyUrl,
		},
	};
}
