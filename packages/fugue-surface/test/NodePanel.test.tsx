import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NodePanel } from "../src/components/NodePanel.js";

// ─── Mock tRPC ────────────────────────────────────────────────────────────────

const mockRefetch = vi.fn();
const mockCreateMutate = vi.fn();
const mockArchiveMutate = vi.fn();

const mockNodes = [
	{ id: "n1", type: "idea", title: "First idea", status: "active" },
	{ id: "n2", type: "decision", title: "Buy Postgres", status: "active" },
];

vi.mock("../src/trpc.js", () => ({
	trpc: {
		nodes: {
			list: {
				useQuery: vi.fn(() => ({
					data: mockNodes,
					refetch: mockRefetch,
				})),
			},
			create: {
				useMutation: vi.fn((opts?: { onSuccess?: () => void }) => ({
					mutate: (input: unknown) => {
						mockCreateMutate(input);
						opts?.onSuccess?.();
					},
					isPending: false,
				})),
			},
			archive: {
				useMutation: vi.fn((opts?: { onSuccess?: () => void }) => ({
					mutate: (input: unknown) => {
						mockArchiveMutate(input);
						opts?.onSuccess?.();
					},
				})),
			},
		},
	},
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
});

describe("NodePanel", () => {
	it("renders the node list", () => {
		render(<NodePanel />);
		expect(screen.getByText("First idea")).toBeDefined();
		expect(screen.getByText("Buy Postgres")).toBeDefined();
	});

	it("shows type badges", () => {
		render(<NodePanel />);
		expect(screen.getByText("idea")).toBeDefined();
		expect(screen.getByText("decision")).toBeDefined();
	});

	it("toggles create form on + button click", () => {
		render(<NodePanel />);
		const addButton = screen.getByLabelText("Add node");
		expect(screen.queryByLabelText("Node title")).toBeNull();

		fireEvent.click(addButton);
		expect(screen.getByLabelText("Node title")).toBeDefined();

		// Cancel hides the form
		fireEvent.click(screen.getByText("Cancel"));
		expect(screen.queryByLabelText("Node title")).toBeNull();
	});

	it("creates a node on form submit", async () => {
		render(<NodePanel />);
		fireEvent.click(screen.getByLabelText("Add node"));

		const input = screen.getByLabelText("Node title");
		fireEvent.change(input, { target: { value: "New idea" } });
		fireEvent.submit(input.closest("form")!);

		expect(mockCreateMutate).toHaveBeenCalledWith({
			type: "idea",
			title: "New idea",
		});
	});

	it("does not create a node with empty title", () => {
		render(<NodePanel />);
		fireEvent.click(screen.getByLabelText("Add node"));
		fireEvent.submit(screen.getByLabelText("Node title").closest("form")!);

		expect(mockCreateMutate).not.toHaveBeenCalled();
	});

	it("archives a node on archive button click", () => {
		render(<NodePanel />);
		fireEvent.click(screen.getByLabelText("Archive First idea"));
		expect(mockArchiveMutate).toHaveBeenCalledWith({ id: "n1" });
	});

	it("shows empty state when no nodes", () => {
		// Override the list query mock for this test to return no nodes
		const listQueryMock = vi.fn(() => ({ data: [], refetch: mockRefetch }));
		const originalImpl = mockNodes;
		// Re-mock nodes.list.useQuery temporarily via the hoisted mock map
		// We test the empty branch by rendering with the override
		mockNodes.length = 0; // mutate the shared array

		render(<NodePanel />);
		expect(screen.getByText(/no active nodes/i)).toBeDefined();

		// Restore
		mockNodes.push(
			{ id: "n1", type: "idea", title: "First idea", status: "active" },
			{ id: "n2", type: "decision", title: "Buy Postgres", status: "active" },
		);
		void listQueryMock;
		void originalImpl; // suppress unused warnings
	});

	it("allows selecting node type", () => {
		render(<NodePanel />);
		fireEvent.click(screen.getByLabelText("Add node"));

		const select = screen.getByLabelText("Node type") as HTMLSelectElement;
		fireEvent.change(select, { target: { value: "decision" } });
		expect(select.value).toBe("decision");

		const input = screen.getByLabelText("Node title");
		fireEvent.change(input, { target: { value: "Use Redis" } });
		fireEvent.submit(input.closest("form")!);

		expect(mockCreateMutate).toHaveBeenCalledWith({
			type: "decision",
			title: "Use Redis",
		});
	});
});
