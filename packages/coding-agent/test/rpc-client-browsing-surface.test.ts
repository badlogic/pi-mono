import { describe, expect, test, vi } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";
import type { RpcResponse } from "../src/modes/rpc/rpc-types.js";

function successResponse(command: string, data?: unknown): RpcResponse {
	if (data === undefined) {
		return { type: "response", command, success: true } as RpcResponse;
	}
	return { type: "response", command, success: true, data } as RpcResponse;
}

function mockSend(
	client: RpcClient,
	response: (command: unknown) => RpcResponse,
): { sent: unknown[]; send: ReturnType<typeof vi.fn> } {
	const sent: unknown[] = [];
	const send = vi.fn(async (command: unknown) => {
		sent.push(command);
		return response(command);
	});
	vi.spyOn(client as any, "send").mockImplementation(send);
	return { sent, send };
}

describe("rpc client browsing surface", () => {
	test("listSessions forwards scope", async () => {
		const client = new RpcClient();
		const { sent } = mockSend(client, () => successResponse("list_sessions", { sessions: [] }));

		await client.listSessions({ scope: "all" });

		expect(sent).toEqual([{ type: "list_sessions", scope: "all" }]);
	});

	test("getTree forwards includeContent flag", async () => {
		const client = new RpcClient();
		const { sent } = mockSend(client, () => successResponse("get_tree", { tree: [], leafId: null }));

		await client.getTree(true);

		expect(sent).toEqual([{ type: "get_tree", includeContent: true }]);
	});

	test("setLabel forwards entry id and label", async () => {
		const client = new RpcClient();
		const { sent } = mockSend(client, () => successResponse("set_label"));

		await client.setLabel("entry-1", "checkpoint");

		expect(sent).toEqual([{ type: "set_label", entryId: "entry-1", label: "checkpoint" }]);
	});

	test("setLabel throws when server returns an error", async () => {
		const client = new RpcClient();
		mockSend(client, () => ({
			type: "response",
			command: "set_label",
			success: false,
			error: "Entry missing not found",
		}));

		await expect(client.setLabel("missing", "checkpoint")).rejects.toThrow("Entry missing not found");
	});

	test("navigateTree forwards options and returns structured result", async () => {
		const client = new RpcClient();
		const { sent } = mockSend(client, () =>
			successResponse("navigate_tree", {
				cancelled: false,
				editorText: "draft",
				summaryEntry: {
					id: "summary-1",
					summary: "summary",
					fromExtension: true,
				},
			}),
		);

		const result = await client.navigateTree("entry-1", {
			summarize: true,
			customInstructions: "focus on files",
			replaceInstructions: false,
			label: "checkpoint",
		});

		expect(sent).toEqual([
			{
				type: "navigate_tree",
				targetId: "entry-1",
				summarize: true,
				customInstructions: "focus on files",
				replaceInstructions: false,
				label: "checkpoint",
			},
		]);
		expect(result.cancelled).toBe(false);
		expect(result.summaryEntry?.fromExtension).toBe(true);
	});
});
