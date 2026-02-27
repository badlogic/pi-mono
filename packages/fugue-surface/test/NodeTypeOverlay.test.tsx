import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock tldraw ──────────────────────────────────────────────────────────────

const mockEditor = {
	getSelectedShapes: vi.fn(),
	getShape: vi.fn(),
	updateShape: vi.fn(),
};

vi.mock("tldraw", async () => {
	const actual = (await vi.importActual("tldraw")) as Record<string, unknown>;
	return {
		...actual,
		useEditor: () => mockEditor,
		useValue: (_key: string, fn: () => unknown, _deps: unknown[]) => fn(),
	};
});

// ─── Mock tRPC ────────────────────────────────────────────────────────────────

const mockCreateMutate = vi.fn();

vi.mock("../src/trpc.js", () => ({
	trpc: {
		nodes: {
			create: {
				useMutation: vi.fn(() => ({
					mutate: (input: unknown, opts?: { onSuccess?: (node: { id: string }) => void }) => {
						mockCreateMutate(input);
						opts?.onSuccess?.({ id: "node-new-123" });
					},
				})),
			},
		},
	},
}));

// ─── Mock shape-meta ──────────────────────────────────────────────────────────

vi.mock("../src/lib/shape-meta.js", async () => {
	const actual = (await vi.importActual("../src/lib/shape-meta.js")) as Record<string, unknown>;
	return {
		...actual,
		setShapeNodeMeta: vi.fn(),
	};
});

import { NodeTypeOverlay } from "../src/components/NodeTypeOverlay.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
});

describe("NodeTypeOverlay", () => {
	it("renders nothing when no shapes are selected", () => {
		mockEditor.getSelectedShapes.mockReturnValue([]);
		const { container } = render(<NodeTypeOverlay />);
		expect(container.firstChild).toBeNull();
	});

	it("renders nothing when multiple shapes are selected", () => {
		mockEditor.getSelectedShapes.mockReturnValue([
			{ id: "s1", type: "geo", meta: {}, props: { text: "" } },
			{ id: "s2", type: "geo", meta: {}, props: { text: "" } },
		]);
		const { container } = render(<NodeTypeOverlay />);
		expect(container.firstChild).toBeNull();
	});

	it("renders nothing when selected shape is an arrow", () => {
		mockEditor.getSelectedShapes.mockReturnValue([{ id: "s1", type: "arrow", meta: {}, props: {} }]);
		const { container } = render(<NodeTypeOverlay />);
		expect(container.firstChild).toBeNull();
	});

	it("shows type picker for untagged shape", () => {
		mockEditor.getSelectedShapes.mockReturnValue([{ id: "s1", type: "geo", meta: {}, props: { text: "My idea" } }]);

		render(<NodeTypeOverlay />);
		expect(screen.getByText("Tag as:")).toBeDefined();
		expect(screen.getByText("Idea")).toBeDefined();
		expect(screen.getByText("Decision")).toBeDefined();
		expect(screen.getByText("Finding")).toBeDefined();
	});

	it("shows all 7 node type buttons", () => {
		mockEditor.getSelectedShapes.mockReturnValue([{ id: "s1", type: "geo", meta: {}, props: { text: "x" } }]);

		render(<NodeTypeOverlay />);
		const types = ["Idea", "Decision", "Assumption", "Finding", "Metric", "Investigation", "Deployment"];
		for (const label of types) {
			expect(screen.getByText(label)).toBeDefined();
		}
	});

	it("assigns node type and calls createNode on button click", () => {
		mockEditor.getSelectedShapes.mockReturnValue([
			{ id: "shape:s1", type: "geo", meta: {}, props: { text: "My idea" } },
		]);
		mockEditor.getShape.mockReturnValue({ id: "shape:s1", type: "geo", meta: {}, props: { text: "My idea" } });

		render(<NodeTypeOverlay />);
		fireEvent.click(screen.getByText("Idea"));

		expect(mockCreateMutate).toHaveBeenCalledWith({ type: "idea", title: "My idea" });
	});

	it("uses 'Untitled' when shape has no text", () => {
		mockEditor.getSelectedShapes.mockReturnValue([{ id: "shape:s1", type: "geo", meta: {}, props: { text: "" } }]);
		mockEditor.getShape.mockReturnValue({ id: "shape:s1", type: "geo", meta: {}, props: { text: "" } });

		render(<NodeTypeOverlay />);
		fireEvent.click(screen.getByText("Decision"));

		expect(mockCreateMutate).toHaveBeenCalledWith({ type: "decision", title: "Untitled" });
	});

	it("shows linked badge when shape already has nodeType", () => {
		mockEditor.getSelectedShapes.mockReturnValue([
			{
				id: "shape:s1",
				type: "geo",
				meta: { nodeType: "idea", nodeId: "node-abc123" },
				props: { text: "My idea" },
			},
		]);

		render(<NodeTypeOverlay />);
		expect(screen.getByText("Idea")).toBeDefined();
		// Should not show the type picker
		expect(screen.queryByText("Tag as:")).toBeNull();
	});

	it("shows node ID suffix in linked badge", () => {
		mockEditor.getSelectedShapes.mockReturnValue([
			{
				id: "shape:s1",
				type: "geo",
				meta: { nodeType: "decision", nodeId: "node-abc123" },
				props: { text: "Use Postgres" },
			},
		]);

		render(<NodeTypeOverlay />);
		expect(screen.getByText(/abc123/)).toBeDefined();
	});
});
