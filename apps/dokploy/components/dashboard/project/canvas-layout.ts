export type CanvasPosition = { x: number; y: number };

export const CANVAS_NODE_WIDTH = 240;
export const CANVAS_NODE_HEIGHT = 84;
const COLUMN_GAP = 220;
const ROW_GAP = 40;

/**
 * Lays services out in columns following the references between them:
 * a service that references others sits to their left, so data flows
 * left → right (apps, then the APIs they call, then databases).
 * Services with no reference at all are placed in a grid below.
 */
export const computeCanvasLayout = (
	nodeIds: string[],
	edges: { source: string; target: string }[],
): Record<string, CanvasPosition> => {
	const ids = new Set(nodeIds);
	const relevant = edges.filter(
		(edge) =>
			ids.has(edge.source) &&
			ids.has(edge.target) &&
			edge.source !== edge.target,
	);
	const connected = new Set(relevant.flatMap((e) => [e.source, e.target]));

	const rank = new Map<string, number>();
	for (const id of connected) rank.set(id, 0);
	// Longest-path ranking; bounded so a reference cycle cannot loop forever.
	for (let pass = 0; pass < connected.size; pass++) {
		let changed = false;
		for (const { source, target } of relevant) {
			const next = (rank.get(source) ?? 0) + 1;
			if (next > (rank.get(target) ?? 0) && next < connected.size) {
				rank.set(target, next);
				changed = true;
			}
		}
		if (!changed) break;
	}

	const positions: Record<string, CanvasPosition> = {};
	const columns = new Map<number, string[]>();
	for (const id of nodeIds) {
		if (!connected.has(id)) continue;
		const column = rank.get(id) ?? 0;
		columns.set(column, [...(columns.get(column) ?? []), id]);
	}

	let tallest = 0;
	for (const [column, members] of columns) {
		members.forEach((id, row) => {
			positions[id] = {
				x: column * (CANVAS_NODE_WIDTH + COLUMN_GAP),
				y: row * (CANVAS_NODE_HEIGHT + ROW_GAP),
			};
		});
		tallest = Math.max(tallest, members.length);
	}

	const isolated = nodeIds.filter((id) => !connected.has(id));
	const offsetY =
		tallest > 0 ? tallest * (CANVAS_NODE_HEIGHT + ROW_GAP) + 80 : 0;
	const perRow = Math.max(3, columns.size);
	isolated.forEach((id, index) => {
		positions[id] = {
			x: (index % perRow) * (CANVAS_NODE_WIDTH + 60),
			y: offsetY + Math.floor(index / perRow) * (CANVAS_NODE_HEIGHT + ROW_GAP),
		};
	});

	return positions;
};
