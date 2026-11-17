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
			aria-label="KTC"
		>
			<rect
				x="2"
				y="2"
				width="60"
				height="60"
				rx="14"
				className="fill-primary"
			/>
			<path
				className="fill-primary-foreground"
				d="M8 20h5v9.4L20.8 20h5.9l-8.4 10.1L27 44h-6l-6-9.5L13 37v7H8zM28 20h13.5v4.6h-4.4V44h-4.7V24.6H28z"
			/>
			<path
				className="fill-none stroke-primary-foreground"
				strokeWidth={4.6}
				d="M55.4 25.2A6.6 9.7 0 1 0 55.4 38.8"
			/>
		</svg>
	);
};
