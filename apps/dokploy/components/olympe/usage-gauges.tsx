import { Progress } from "@/components/ui/progress";
import { formatBytes, formatMemoryMb } from "./format";

type Plan = {
	cpu: number;
	memoryMb: number;
	diskGb: number;
	maxServices: number;
	maxDatabases: number;
	maxDomains: number;
	maxMembers: number;
};

type Usage = {
	cpu: number;
	memoryMb: number;
	diskBytes: number;
	services: number;
	databases: number;
	domains: number;
	members: number;
};

const Gauge = ({
	label,
	used,
	max,
	display,
}: {
	label: string;
	used: number;
	max: number;
	display: string;
}) => {
	const percent = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 100;
	return (
		<div className="flex flex-col gap-1.5" data-no-translate>
			<div className="flex items-center justify-between text-sm">
				<span className="font-medium">{label}</span>
				<span
					className={percent >= 90 ? "text-red-500" : "text-muted-foreground"}
				>
					{display}
				</span>
			</div>
			<Progress value={percent} className="h-2" />
		</div>
	);
};

export const UsageGauges = ({ plan, usage }: { plan: Plan; usage: Usage }) => (
	<div className="grid gap-4 sm:grid-cols-2">
		<Gauge
			label="Processeur réservé"
			used={usage.cpu}
			max={plan.cpu}
			display={`${Math.round(usage.cpu * 100) / 100} / ${plan.cpu} vCPU`}
		/>
		<Gauge
			label="Mémoire réservée"
			used={usage.memoryMb}
			max={plan.memoryMb}
			display={`${formatMemoryMb(usage.memoryMb)} / ${formatMemoryMb(plan.memoryMb)}`}
		/>
		<Gauge
			label="Disque (volumes)"
			used={usage.diskBytes}
			max={plan.diskGb * 1024 ** 3}
			display={`${formatBytes(usage.diskBytes)} / ${plan.diskGb} Go`}
		/>
		<Gauge
			label="Services"
			used={usage.services}
			max={plan.maxServices}
			display={`${usage.services} / ${plan.maxServices}`}
		/>
		<Gauge
			label="Bases de données"
			used={usage.databases}
			max={plan.maxDatabases}
			display={`${usage.databases} / ${plan.maxDatabases}`}
		/>
		<Gauge
			label="Domaines"
			used={usage.domains}
			max={plan.maxDomains}
			display={`${usage.domains} / ${plan.maxDomains}`}
		/>
		<Gauge
			label="Membres"
			used={usage.members}
			max={plan.maxMembers}
			display={`${usage.members} / ${plan.maxMembers}`}
		/>
	</div>
);
