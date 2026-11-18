import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

interface Props {
	className?: string;
	logoUrl?: string;
	logoLightUrl?: string;
}

export const Logo = ({
	className = "size-14",
	logoUrl,
	logoLightUrl,
}: Props) => {
	const { resolvedTheme } = useTheme();
	const effectiveUrl =
		resolvedTheme === "light" && logoLightUrl ? logoLightUrl : logoUrl;

	if (effectiveUrl) {
		return (
			<img
				src={effectiveUrl}
				alt="Organization Logo"
				className={cn(className, "object-contain rounded-sm")}
			/>
		);
	}

	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 64 64"
			className={className}
			role="img"
			aria-label="Olympe"
		>
			<rect
				x="2"
				y="2"
				width="60"
				height="60"
				rx="14"
				className="fill-primary"
			/>
			<circle
				cx="32"
				cy="32"
				r="18"
				strokeWidth={5}
				className="fill-none stroke-primary-foreground"
			/>
			<path
				d="M19 40 L28 25 L32 31 L36 26 L45 40 Z"
				className="fill-primary-foreground"
			/>
		</svg>
	);
};
