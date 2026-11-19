import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/shared/logo";
import { BRAND_NAME } from "@/lib/brand";

export interface ShellStep {
	id: string;
	title: string;
	onSelect?: () => void;
}

interface Props {
	steps: ShellStep[];
	currentIndex: number;
	onSkip?: () => void;
	skipLabel?: string;
	children: ReactNode;
}

export const OnboardingShell = ({
	steps,
	currentIndex,
	onSkip,
	skipLabel = "Skip all",
	children,
}: Props) => (
	<div className="fixed inset-0 z-50 flex flex-col md:flex-row bg-background text-foreground">
		<aside className="relative shrink-0 md:w-[300px] lg:w-[340px] overflow-hidden bg-zinc-950 text-zinc-400">
			<div
				className="pointer-events-none absolute inset-0 opacity-[0.07]"
				style={{
					backgroundImage:
						"linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
					backgroundSize: "28px 28px",
				}}
			/>
			<div className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full bg-white/10 blur-[100px]" />

			<div className="relative flex md:h-full flex-col p-6 lg:p-8">
				<div className="flex items-center justify-between md:block">
					<div className="flex items-center gap-2.5 text-zinc-50 [&_path]:!fill-white [&_path]:!stroke-white">
						<Logo className="size-7" />
						<span className="text-lg font-semibold tracking-tight">
							{BRAND_NAME}
						</span>
					</div>
					{onSkip && (
						<button
							type="button"
							onClick={onSkip}
							className="font-mono text-[11px] uppercase tracking-wider text-zinc-400 hover:text-zinc-100 transition-colors md:hidden"
						>
							{skipLabel}
						</button>
					)}
				</div>

				<ol className="hidden md:flex flex-col gap-0.5 mt-12">
					{steps.map((step, index) => {
						const isDone = index < currentIndex;
						const isCurrent = index === currentIndex;
						return (
							<li
								key={step.id}
								className="flex gap-3.5"
								aria-current={isCurrent ? "step" : undefined}
							>
								<div className="flex flex-col items-center">
									<span
										className={`flex items-center justify-center font-mono text-[11px] tabular-nums size-5 rounded-full ${
											isCurrent
												? "bg-white text-zinc-950 font-semibold"
												: isDone
													? "text-zinc-100"
													: "text-zinc-400"
										}`}
									>
										{isDone ? (
											<CheckIcon className="size-3" />
										) : (
											String(index + 1).padStart(2, "0")
										)}
									</span>
									{index < steps.length - 1 && (
										<span
											className={`w-px flex-1 min-h-7 my-1.5 ${
												isDone ? "bg-zinc-400" : "bg-zinc-700"
											}`}
										/>
									)}
								</div>
								{isDone && step.onSelect ? (
									<button
										type="button"
										onClick={step.onSelect}
										className="text-sm font-medium transition-colors pb-6 last:pb-0 text-zinc-100 hover:text-white text-left"
									>
										{step.title}
									</button>
								) : (
									<p
										className={`text-sm font-medium transition-colors pb-6 last:pb-0 ${
											isCurrent
												? "text-white"
												: isDone
													? "text-zinc-100"
													: "text-zinc-400"
										}`}
									>
										{step.title}
									</p>
								)}
							</li>
						);
					})}
				</ol>

				<div className="hidden md:flex flex-col gap-4 mt-auto pt-8 border-t border-zinc-800">
					{onSkip && (
						<button
							type="button"
							onClick={onSkip}
							className="w-fit font-mono text-[11px] uppercase tracking-wider text-zinc-400 hover:text-zinc-100 transition-colors"
						>
							{skipLabel} →
						</button>
					)}
				</div>
			</div>
		</aside>

		<div className="flex-1 overflow-y-auto">
			<div className="mx-auto w-full max-w-2xl px-6 py-14 lg:py-20">
				{children}
			</div>
		</div>
	</div>
);
