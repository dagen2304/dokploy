import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Logo } from "@/components/shared/logo";

export const LegalPage = ({
	title,
	updatedAt,
	markdown,
}: {
	title: string;
	updatedAt: string;
	markdown: string;
}) => (
	<div className="min-h-screen bg-background text-foreground" data-no-translate>
		<header className="border-b">
			<div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
				<Link href="/" className="flex items-center gap-2 font-semibold">
					<Logo className="size-8" />
					Olympe
				</Link>
				<nav className="flex gap-4 text-sm text-muted-foreground">
					<Link href="/conditions" className="hover:text-foreground">
						Conditions
					</Link>
					<Link href="/confidentialite" className="hover:text-foreground">
						Confidentialité
					</Link>
				</nav>
			</div>
		</header>
		<main className="mx-auto max-w-3xl px-6 py-10">
			<h1 className="text-3xl font-semibold">{title}</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				Dernière mise à jour : {updatedAt}
			</p>
			<article className="prose prose-neutral dark:prose-invert mt-8 max-w-none prose-table:text-sm prose-th:text-left">
				<ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
			</article>
		</main>
	</div>
);
