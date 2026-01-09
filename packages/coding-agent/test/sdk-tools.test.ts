import { beforeEach, describe, expect, it, vi } from "vitest";
import { bashTool, createAgentSession, editTool, readTool, writeTool } from "../src/core/sdk.js";
import { SessionManager } from "../src/core/session-manager.js";

// Mock console.error to capture warnings
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

describe("SDK tool filtering", () => {
	beforeEach(() => {
		consoleErrorSpy.mockClear();
	});

	it("uses default tools when toolNames not specified", async () => {
		const { session } = await createAgentSession({
			sessionManager: SessionManager.inMemory(),
			extensions: [], // Skip extension discovery
			skills: [],
		});

		const toolNames = session.getActiveToolNames();
		expect(toolNames).toContain("read");
		expect(toolNames).toContain("bash");
		expect(toolNames).toContain("edit");
		expect(toolNames).toContain("write");
	});

	it("filters to only specified built-in tools via toolNames", async () => {
		const { session } = await createAgentSession({
			sessionManager: SessionManager.inMemory(),
			extensions: [],
			skills: [],
			toolNames: ["read", "bash"],
		});

		const toolNames = session.getActiveToolNames();
		expect(toolNames).toEqual(["read", "bash"]);
		expect(toolNames).not.toContain("edit");
		expect(toolNames).not.toContain("write");
	});

	it("enables no tools when toolNames is empty array", async () => {
		const { session } = await createAgentSession({
			sessionManager: SessionManager.inMemory(),
			extensions: [],
			skills: [],
			toolNames: [],
		});

		const toolNames = session.getActiveToolNames();
		expect(toolNames).toEqual([]);
	});

	it("warns about unknown tool names", async () => {
		await createAgentSession({
			sessionManager: SessionManager.inMemory(),
			extensions: [],
			skills: [],
			toolNames: ["read", "nonexistent-tool"],
		});

		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown tool "nonexistent-tool"'));
	});

	it("ignores unknown tools but keeps valid ones", async () => {
		const { session } = await createAgentSession({
			sessionManager: SessionManager.inMemory(),
			extensions: [],
			skills: [],
			toolNames: ["read", "nonexistent", "bash"],
		});

		const toolNames = session.getActiveToolNames();
		expect(toolNames).toEqual(["read", "bash"]);
	});

	it("toolNames overrides tools option", async () => {
		const { session } = await createAgentSession({
			sessionManager: SessionManager.inMemory(),
			extensions: [],
			skills: [],
			tools: [readTool, bashTool, editTool, writeTool], // All 4 tools
			toolNames: ["read"], // But only enable read
		});

		const toolNames = session.getActiveToolNames();
		expect(toolNames).toEqual(["read"]);
	});
});
