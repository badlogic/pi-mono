import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import { sessionNotificationSchema, toolCallUpdateSchema } from "@agentclientprotocol/sdk";
import { describe, expect, test, vi } from "vitest";
import { AcpAgent } from "../src/modes/acp/acp-agent.js";

/**
 * ACP Schema Validation Tests
 *
 * These tests validate that ACP session/update payloads conform to the
 * Zod schema from @agentclientprotocol/sdk. This ensures protocol compliance
 * by catching schema violations.
 */
describe("ACP schema validation", () => {
	/**
	 * Helper to create a mock connection and AcpAgent for testing.
	 */
	function createTestAgent() {
		const updates: unknown[] = [];
		const connection = {
			sessionUpdate: vi.fn().mockImplementation(async (payload: unknown) => {
				updates.push(payload);
			}),
		} as unknown as AgentSideConnection;

		const agent = new AcpAgent(connection, { cwd: process.cwd() });
		return { agent, connection, updates };
	}

	/**
	 * Helper to invoke the private handleAgentEvent method.
	 */
	function handleAgentEvent(agent: AcpAgent, sessionId: string, event: unknown) {
		(agent as unknown as { handleAgentEvent: (sid: string, ev: unknown) => void }).handleAgentEvent(sessionId, event);
	}

	describe("agent_message_chunk validation", () => {
		test("text content validates against sessionNotificationSchema", async () => {
			const { agent, updates } = createTestAgent();
			const sessionId = "schema-test-1";

			handleAgentEvent(agent, sessionId, {
				type: "message_start",
				message: { role: "assistant", content: "" },
			});
			handleAgentEvent(agent, sessionId, {
				type: "message_update",
				message: { role: "assistant", content: "" },
				assistantMessageEvent: {
					type: "text_delta",
					contentIndex: 0,
					delta: "Hello world",
					partial: { role: "assistant", content: "Hello world" },
				},
			});
			handleAgentEvent(agent, sessionId, {
				type: "message_end",
				message: { role: "assistant", content: "Hello world" },
			});

			expect(updates).toHaveLength(1);
			const payload = updates[0];

			// Validate against ACP schema
			const result = sessionNotificationSchema.safeParse(payload);
			if (!result.success) {
				console.error("Schema validation failed:", JSON.stringify(result.error.issues, null, 2));
			}
			expect(result.success).toBe(true);

			// Also verify the structure matches expected shape
			expect(payload).toMatchObject({
				sessionId,
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Hello world" },
				},
			});
		});

		test("non-streaming message (message_end without deltas) validates", async () => {
			const { agent, updates } = createTestAgent();
			const sessionId = "schema-test-2";

			handleAgentEvent(agent, sessionId, {
				type: "message_start",
				message: { role: "assistant", content: "" },
			});
			handleAgentEvent(agent, sessionId, {
				type: "message_end",
				message: { role: "assistant", content: "Non-streaming response" },
			});

			expect(updates).toHaveLength(1);
			const payload = updates[0];

			const result = sessionNotificationSchema.safeParse(payload);
			if (!result.success) {
				console.error("Schema validation failed:", JSON.stringify(result.error.issues, null, 2));
			}
			expect(result.success).toBe(true);
		});
	});

	describe("tool_call validation", () => {
		test("tool_execution_start validates against sessionNotificationSchema", async () => {
			const { agent, updates } = createTestAgent();
			const sessionId = "schema-test-3";

			handleAgentEvent(agent, sessionId, {
				type: "tool_execution_start",
				toolCallId: "tc1",
				toolName: "read",
				args: { path: "test.txt" },
			});

			expect(updates).toHaveLength(1);
			const payload = updates[0];

			const result = sessionNotificationSchema.safeParse(payload);
			if (!result.success) {
				console.error("Schema validation failed:", JSON.stringify(result.error.issues, null, 2));
			}
			expect(result.success).toBe(true);

			// Verify it's a tool_call (not tool_call_update)
			expect((payload as { update: { sessionUpdate: string } }).update.sessionUpdate).toBe("tool_call");
		});
	});

	describe("tool_call_update validation", () => {
		test("completed tool call validates against sessionNotificationSchema", async () => {
			const { agent, updates } = createTestAgent();
			const sessionId = "schema-test-4";

			handleAgentEvent(agent, sessionId, {
				type: "tool_execution_end",
				toolCallId: "tc2",
				toolName: "read",
				args: { path: "test.txt" },
				result: {
					content: [{ type: "text", text: "file contents" }],
				},
				isError: false,
			});

			expect(updates).toHaveLength(1);
			const payload = updates[0];

			const result = sessionNotificationSchema.safeParse(payload);
			if (!result.success) {
				console.error("Schema validation failed:", JSON.stringify(result.error.issues, null, 2));
			}
			expect(result.success).toBe(true);

			// Verify it's a tool_call_update
			expect((payload as { update: { sessionUpdate: string } }).update.sessionUpdate).toBe("tool_call_update");
		});

		test("in_progress tool call validates against sessionNotificationSchema", async () => {
			const { agent, updates } = createTestAgent();
			const sessionId = "schema-test-5";

			handleAgentEvent(agent, sessionId, {
				type: "tool_execution_update",
				toolCallId: "tc3",
				toolName: "bash",
				args: { command: "echo hi" },
				partialResult: { content: [{ type: "text", text: "partial output" }] },
			});

			expect(updates).toHaveLength(1);
			const payload = updates[0];

			const result = sessionNotificationSchema.safeParse(payload);
			if (!result.success) {
				console.error("Schema validation failed:", JSON.stringify(result.error.issues, null, 2));
			}
			expect(result.success).toBe(true);

			// Verify status is in_progress
			expect((payload as { update: { status: string } }).update.status).toBe("in_progress");
		});

		test("failed tool call validates against sessionNotificationSchema", async () => {
			const { agent, updates } = createTestAgent();
			const sessionId = "schema-test-6";

			handleAgentEvent(agent, sessionId, {
				type: "tool_execution_end",
				toolCallId: "tc4",
				toolName: "read",
				args: { path: "nonexistent.txt" },
				result: {
					content: [{ type: "text", text: "File not found" }],
				},
				isError: true,
			});

			expect(updates).toHaveLength(1);
			const payload = updates[0];

			const result = sessionNotificationSchema.safeParse(payload);
			if (!result.success) {
				console.error("Schema validation failed:", JSON.stringify(result.error.issues, null, 2));
			}
			expect(result.success).toBe(true);

			// Verify status is failed
			expect((payload as { update: { status: string } }).update.status).toBe("failed");
		});
	});

	describe("tool content block validation", () => {
		test("image content in tool result validates", async () => {
			const { agent, updates } = createTestAgent();
			const sessionId = "schema-test-7";

			handleAgentEvent(agent, sessionId, {
				type: "tool_execution_end",
				toolCallId: "tc5",
				toolName: "read",
				args: { path: "image.png" },
				result: {
					content: [
						{ type: "text", text: "Read image file [image/png]" },
						{ type: "image", data: "AAAA", mimeType: "image/png" },
					],
				},
				isError: false,
			});

			expect(updates).toHaveLength(1);
			const payload = updates[0];

			const result = sessionNotificationSchema.safeParse(payload);
			if (!result.success) {
				console.error("Schema validation failed:", JSON.stringify(result.error.issues, null, 2));
			}
			expect(result.success).toBe(true);
		});

		test("diff content in edit tool result validates", async () => {
			const { agent, updates } = createTestAgent();
			const sessionId = "schema-test-8";

			handleAgentEvent(agent, sessionId, {
				type: "tool_execution_end",
				toolCallId: "tc6",
				toolName: "edit",
				args: { path: "file.txt", oldText: "before", newText: "after" },
				result: {
					content: [{ type: "text", text: "ok" }],
					details: { diff: "-1 before\n+1 after" },
				},
				isError: false,
			});

			expect(updates).toHaveLength(1);
			const payload = updates[0];

			const result = sessionNotificationSchema.safeParse(payload);
			if (!result.success) {
				console.error("Schema validation failed:", JSON.stringify(result.error.issues, null, 2));
			}
			expect(result.success).toBe(true);

			// Verify diff content is present
			const update = (payload as { update: { content: { type: string }[] } }).update;
			const diffContent = update.content.find((c) => c.type === "diff");
			expect(diffContent).toBeDefined();
		});
	});

	describe("locations validation", () => {
		test("tool call with locations validates", async () => {
			const { agent, updates } = createTestAgent();
			const sessionId = "schema-test-9";

			handleAgentEvent(agent, sessionId, {
				type: "tool_execution_end",
				toolCallId: "tc7",
				toolName: "read",
				args: { path: "/absolute/path/to/file.txt" },
				result: {
					content: [{ type: "text", text: "file contents" }],
				},
				isError: false,
			});

			expect(updates).toHaveLength(1);
			const payload = updates[0];

			const result = sessionNotificationSchema.safeParse(payload);
			if (!result.success) {
				console.error("Schema validation failed:", JSON.stringify(result.error.issues, null, 2));
			}
			expect(result.success).toBe(true);

			// Verify locations are present
			const update = (payload as { update: { locations: { path: string }[] } }).update;
			expect(update.locations).toEqual([{ path: "/absolute/path/to/file.txt" }]);
		});
	});

	describe("toolCallUpdateSchema direct validation", () => {
		test("validates a minimal tool_call_update payload", () => {
			const update = {
				toolCallId: "test-id",
				status: "completed",
			};

			const result = toolCallUpdateSchema.safeParse(update);
			expect(result.success).toBe(true);
		});

		test("validates a full tool_call_update payload", () => {
			const update = {
				toolCallId: "test-id",
				status: "completed",
				kind: "read",
				title: "Reading file.txt",
				locations: [{ path: "file.txt" }],
				content: [{ type: "content", content: { type: "text", text: "hello" } }],
				rawInput: { path: "file.txt" },
				rawOutput: { text: "hello" },
			};

			const result = toolCallUpdateSchema.safeParse(update);
			if (!result.success) {
				console.error("Schema validation failed:", JSON.stringify(result.error.issues, null, 2));
			}
			expect(result.success).toBe(true);
		});

		test("rejects invalid status", () => {
			const update = {
				toolCallId: "test-id",
				status: "invalid_status",
			};

			const result = toolCallUpdateSchema.safeParse(update);
			expect(result.success).toBe(false);
		});

		test("rejects invalid kind", () => {
			const update = {
				toolCallId: "test-id",
				kind: "invalid_kind",
			};

			const result = toolCallUpdateSchema.safeParse(update);
			expect(result.success).toBe(false);
		});
	});
});
