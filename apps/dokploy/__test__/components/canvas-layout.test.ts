import { describe, expect, it } from "vitest";
import { computeCanvasLayout } from "@/components/dashboard/project/canvas-layout";

describe("computeCanvasLayout", () => {
	it("places referencing services left of what they reference", () => {
		const layout = computeCanvasLayout(
			["web", "api", "db", "cache"],
			[
				{ source: "web", target: "api" },
				{ source: "api", target: "db" },
				{ source: "api", target: "cache" },
			],
		);
		expect(layout.web?.x).toBeLessThan(layout.api?.x ?? 0);
		expect(layout.api?.x).toBeLessThan(layout.db?.x ?? 0);
		expect(layout.db?.x).toBe(layout.cache?.x);
		expect(layout.db?.y).not.toBe(layout.cache?.y);
	});

	it("puts unconnected services in a grid below the graph", () => {
		const layout = computeCanvasLayout(
			["api", "db", "lonely"],
			[{ source: "api", target: "db" }],
		);
		expect(layout.lonely?.y).toBeGreaterThan(layout.db?.y ?? 0);
	});

	it("terminates on reference cycles and positions every node", () => {
		const layout = computeCanvasLayout(
			["a", "b"],
			[
				{ source: "a", target: "b" },
				{ source: "b", target: "a" },
			],
		);
		expect(Object.keys(layout).sort()).toEqual(["a", "b"]);
	});

	it("ignores edges to services that are filtered out", () => {
		const layout = computeCanvasLayout(
			["api"],
			[{ source: "api", target: "db" }],
		);
		expect(layout.api).toEqual({ x: 0, y: 0 });
	});
});
