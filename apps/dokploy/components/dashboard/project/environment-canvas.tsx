import {
	Background,
	Controls,
	type Edge,
	Handle,
	MarkerType,
	MiniMap,
	type Node,
	type NodeProps,
	type NodeTypes,
	Panel,
	Position,
	ReactFlow,
	useEdgesState,
	useNodesState,
} from "@xyflow/react";
import { CircuitBoard, GlobeIcon, LayoutGrid, ServerIcon } from "lucide-react";
import { useRouter } from "next/router";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo } from "react";
import {
	LibsqlIcon,
	MariadbIcon,
	MongodbIcon,
	MysqlIcon,
	PostgresqlIcon,
	RedisIcon,
} from "@/components/icons/data-tools-icons";
import { StatusTooltip } from "@/components/shared/status-tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/utils/api";
import {
	CANVAS_NODE_HEIGHT,
	CANVAS_NODE_WIDTH,
	type CanvasPosition,
	computeCanvasLayout,
} from "./canvas-layout";

export type CanvasService = {
	id: string;
	name: string;
	type:
		| "application"
		| "compose"
		| "postgres"
		| "mysql"
		| "mariadb"
		| "mongo"
		| "redis"
		| "libsql";
	status?: "idle" | "running" | "done" | "error" | null;
	icon?: string | null;
	serverName?: string | null;
};

type ServiceNodeData = { service: CanvasService };
type ServiceNode = Node<ServiceNodeData, "service">;

const TYPE_LABELS: Record<CanvasService["type"], string> = {
	application: "Application",
	compose: "Compose",
	postgres: "PostgreSQL",
	mysql: "MySQL",
	mariadb: "MariaDB",
	mongo: "MongoDB",
	redis: "Redis",
	libsql: "libSQL",
};

const ServiceIcon = ({ service }: { service: CanvasService }) => {
	if (service.icon) {
		return (
			<img
				src={service.icon}
				alt=""
				className="size-7 object-contain rounded-sm"
			/>
		);
	}
	switch (service.type) {
		case "postgres":
			return <PostgresqlIcon className="size-7" />;
		case "redis":
			return <RedisIcon className="size-7" />;
		case "mariadb":
			return <MariadbIcon className="size-7" />;
		case "mongo":
			return <MongodbIcon className="size-7" />;
		case "mysql":
			return <MysqlIcon className="size-7" />;
		case "libsql":
			return <LibsqlIcon className="size-6" />;
		case "compose":
			return <CircuitBoard className="size-6" />;
		default:
			return <GlobeIcon className="size-6" />;
	}
};

const ServiceNodeCard = ({ data, selected }: NodeProps<ServiceNode>) => {
	const { service } = data;
	return (
		<div
			className={cn(
				"relative flex items-center gap-3 rounded-xl border bg-background px-4 shadow-sm transition-colors hover:bg-border cursor-pointer",
				selected && "ring-2 ring-primary",
			)}
			style={{ width: CANVAS_NODE_WIDTH, height: CANVAS_NODE_HEIGHT }}
		>
			<Handle
				type="target"
				position={Position.Left}
				isConnectable={false}
				className="!opacity-0"
			/>
			<div className="shrink-0">
				<ServiceIcon service={service} />
			</div>
			<div className="flex min-w-0 flex-col gap-1">
				<span className="truncate text-sm font-medium">{service.name}</span>
				<span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
					{TYPE_LABELS[service.type]}
					{service.serverName && (
						<>
							<ServerIcon className="size-3 shrink-0" />
							<span className="truncate">{service.serverName}</span>
						</>
					)}
				</span>
			</div>
			<div className="absolute -right-1 -top-2">
				<StatusTooltip status={service.status} />
			</div>
			<Handle
				type="source"
				position={Position.Right}
				isConnectable={false}
				className="!opacity-0"
			/>
		</div>
	);
};

const nodeTypes: NodeTypes = { service: ServiceNodeCard };

const storageKey = (environmentId: string) => `ktc:canvas:${environmentId}`;

const readSavedPositions = (
	environmentId: string,
): Record<string, CanvasPosition> => {
	try {
		return JSON.parse(localStorage.getItem(storageKey(environmentId)) ?? "{}");
	} catch {
		return {};
	}
};

const savePositions = (
	environmentId: string,
	positions: Record<string, CanvasPosition>,
) => {
	try {
		localStorage.setItem(storageKey(environmentId), JSON.stringify(positions));
	} catch {
		// Storage can be full or disabled; the canvas still works without it.
	}
};

interface Props {
	projectId: string;
	environmentId: string;
	services: CanvasService[];
}

export const EnvironmentCanvas = ({
	projectId,
	environmentId,
	services,
}: Props) => {
	const router = useRouter();
	const { resolvedTheme } = useTheme();
	const { data: graph } = api.environment.serviceGraph.useQuery(
		{ environmentId },
		{ enabled: !!environmentId },
	);

	// Keyed on content, not identity: a refetch returning the same graph or a
	// parent re-render must not re-run the layout (and reset node positions).
	const edgesKey = JSON.stringify(graph?.edges ?? []);
	const servicesKey = JSON.stringify(services);

	const flowEdges = useMemo<Edge[]>(
		() =>
			(JSON.parse(edgesKey) as NonNullable<typeof graph>["edges"]).map(
				(edge) => ({
					id: `${edge.source}->${edge.target}`,
					source: edge.source,
					target: edge.target,
					animated: true,
					label:
						edge.keys.length > 2
							? `${edge.keys.slice(0, 2).join(", ")} +${edge.keys.length - 2}`
							: edge.keys.join(", "),
					labelBgPadding: [6, 3],
					labelBgBorderRadius: 4,
					labelStyle: { fontSize: 11 },
					markerEnd: { type: MarkerType.ArrowClosed },
				}),
			),
		[edgesKey],
	);

	const buildNodes = useCallback(
		(ignoreSaved = false): ServiceNode[] => {
			const current = JSON.parse(servicesKey) as CanvasService[];
			const auto = computeCanvasLayout(
				current.map((s) => s.id),
				flowEdges,
			);
			const saved = ignoreSaved ? {} : readSavedPositions(environmentId);
			return current.map((service) => ({
				id: service.id,
				type: "service",
				position: saved[service.id] ?? auto[service.id] ?? { x: 0, y: 0 },
				data: { service },
			}));
		},
		[servicesKey, flowEdges, environmentId],
	);

	const [nodes, setNodes, onNodesChange] = useNodesState<ServiceNode>([]);
	const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

	useEffect(() => {
		setNodes(buildNodes());
	}, [buildNodes, setNodes]);

	useEffect(() => {
		setEdges(flowEdges);
	}, [flowEdges, setEdges]);

	const persist = useCallback(
		(current: ServiceNode[]) => {
			savePositions(
				environmentId,
				Object.fromEntries(current.map((node) => [node.id, node.position])),
			);
		},
		[environmentId],
	);

	const resetLayout = () => {
		const fresh = buildNodes(true);
		setNodes(fresh);
		persist(fresh);
	};

	return (
		<div className="h-[70vh] w-full overflow-hidden rounded-xl border">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onNodeDragStop={(_, __, dragged) => {
					const moved = new Map(
						dragged.map((node) => [node.id, node.position]),
					);
					persist(
						nodes.map((node) => ({
							...node,
							position: moved.get(node.id) ?? node.position,
						})),
					);
				}}
				onNodeClick={(_, node) =>
					router.push(
						`/dashboard/project/${projectId}/environment/${environmentId}/services/${node.data.service.type}/${node.id}`,
					)
				}
				nodesConnectable={false}
				edgesFocusable={false}
				colorMode={resolvedTheme === "dark" ? "dark" : "light"}
				fitView
				fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
				minZoom={0.2}
			>
				<Background gap={20} />
				<Controls showInteractive={false} />
				<MiniMap pannable zoomable />
				<Panel position="top-right">
					<Button variant="outline" size="sm" onClick={resetLayout}>
						<LayoutGrid className="mr-2 size-4" />
						Auto layout
					</Button>
				</Panel>
				{flowEdges.length === 0 && services.length > 1 && (
					<Panel position="bottom-center">
						<p className="rounded-md bg-background/90 px-3 py-1.5 text-xs text-muted-foreground border">
							Link services with references such as{" "}
							<code>{"${{postgres.DATABASE_URL}}"}</code> in their variables to
							see arrows here.
						</p>
					</Panel>
				)}
			</ReactFlow>
		</div>
	);
};
