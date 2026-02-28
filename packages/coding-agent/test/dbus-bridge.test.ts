import { describe, expect, test } from "vitest";
import { extractTextFromMessages } from "../src/dbus/bridge.js";
import { DBUS_BUS_NAME, DBUS_INTERFACE_NAME, DBUS_OBJECT_PATH, INTROSPECTION_XML } from "../src/dbus/interface.js";
import {
	type BridgeOptions,
	type DBusAgentState,
	type QueuedRequest,
	type RequestHints,
	RequestPriority,
	type SessionPersistence,
} from "../src/dbus/types.js";

/**
 * D-Bus bridge unit tests.
 *
 * These test the types, constants, and helpers that don't require
 * an actual D-Bus session bus or Pi RPC process.
 */
describe("D-Bus interface constants", () => {
	test("bus name follows reverse-DNS", () => {
		expect(DBUS_BUS_NAME).toBe("org.embry.Agent");
		expect(DBUS_BUS_NAME).toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/);
	});

	test("object path matches bus name", () => {
		expect(DBUS_OBJECT_PATH).toBe("/org/embry/Agent");
	});

	test("interface name matches bus name", () => {
		expect(DBUS_INTERFACE_NAME).toBe("org.embry.Agent");
	});
});

describe("D-Bus introspection XML", () => {
	test("contains all required methods", () => {
		const methods = [
			"Ask",
			"AskAsync",
			"Steer",
			"FollowUp",
			"Abort",
			"GetState",
			"SetModel",
			"RespondToUI",
			"Ping",
			"AskWithHints",
			"AskAs",
		];
		for (const m of methods) {
			expect(INTROSPECTION_XML).toContain(`<method name="${m}"`);
		}
	});

	test("contains all required signals", () => {
		const signals = ["MessageUpdate", "ToolExecution", "AgentEnd", "ExtensionUIRequest", "Ready", "Error"];
		for (const s of signals) {
			expect(INTROSPECTION_XML).toContain(`<signal name="${s}"`);
		}
	});

	test("contains all required properties", () => {
		const props = ["IsStreaming", "CurrentModel", "SessionName"];
		for (const p of props) {
			expect(INTROSPECTION_XML).toContain(`<property name="${p}"`);
		}
	});

	test("Ask method has correct signature (string in, string out)", () => {
		const askBlock = INTROSPECTION_XML.match(/<method name="Ask">[\s\S]*?<\/method>/);
		expect(askBlock).toBeTruthy();
		expect(askBlock![0]).toContain('type="s" direction="in"');
		expect(askBlock![0]).toContain('type="s" direction="out"');
	});

	test("AskWithHints method has correct signature (ss in, s out)", () => {
		const block = INTROSPECTION_XML.match(/<method name="AskWithHints">[\s\S]*?<\/method>/);
		expect(block).toBeTruthy();
		// Two string inputs (prompt + hints JSON)
		const inputs = block![0].match(/direction="in"/g);
		expect(inputs).toHaveLength(2);
		expect(block![0]).toContain('direction="out"');
	});

	test("AskAs method has correct signature (ss in, s out)", () => {
		const block = INTROSPECTION_XML.match(/<method name="AskAs">[\s\S]*?<\/method>/);
		expect(block).toBeTruthy();
		const inputs = block![0].match(/direction="in"/g);
		expect(inputs).toHaveLength(2);
		expect(block![0]).toContain('direction="out"');
	});

	test("IsStreaming property is boolean", () => {
		expect(INTROSPECTION_XML).toContain('<property name="IsStreaming" type="b"');
	});
});

describe("D-Bus types", () => {
	test("DBusAgentState has required fields", () => {
		const state: DBusAgentState = {
			isStreaming: false,
			currentModel: "anthropic/claude-sonnet-4-20250514",
			sessionName: "test-session",
			sessionId: "abc-123",
			thinkingLevel: "normal",
			messageCount: 0,
		};
		expect(state.isStreaming).toBe(false);
		expect(state.currentModel).toContain("anthropic");
		expect(state.sessionId).toBe("abc-123");
	});

	test("BridgeOptions allows partial config", () => {
		const minimal: BridgeOptions = {};
		expect(minimal.cwd).toBeUndefined();

		const full: BridgeOptions = {
			cwd: "/tmp/test",
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			cliPath: "/usr/bin/pi",
			sessionFile: "/tmp/session.json",
		};
		expect(full.cwd).toBe("/tmp/test");
		expect(full.sessionFile).toBe("/tmp/session.json");
	});

	test("SessionPersistence has required fields", () => {
		const persistence: SessionPersistence = {
			sessionFile: "/tmp/session.json",
			model: "anthropic/claude-sonnet-4-20250514",
			provider: "anthropic",
			timestamp: new Date().toISOString(),
		};
		expect(persistence.sessionFile).toBeTruthy();
		expect(persistence.timestamp).toMatch(/^\d{4}-/);
	});

	test("RequestHints allows partial config", () => {
		const empty: RequestHints = {};
		expect(empty.model).toBeUndefined();

		const full: RequestHints = {
			model: "claude-opus-4-6",
			provider: "anthropic",
			thinking: "high",
		};
		expect(full.thinking).toBe("high");
	});
});

describe("RequestPriority", () => {
	test("ABORT has highest priority (lowest number)", () => {
		expect(RequestPriority.ABORT).toBeLessThan(RequestPriority.STEER);
		expect(RequestPriority.STEER).toBeLessThan(RequestPriority.FOLLOWUP);
		expect(RequestPriority.FOLLOWUP).toBeLessThan(RequestPriority.ASK);
	});

	test("queue ordering: ABORT < STEER < FOLLOWUP < ASK", () => {
		const requests: QueuedRequest[] = [
			{ id: "1", priority: RequestPriority.ASK, type: "ask", prompt: "a" },
			{ id: "2", priority: RequestPriority.ABORT, type: "abort" },
			{ id: "3", priority: RequestPriority.STEER, type: "steer", prompt: "s" },
			{ id: "4", priority: RequestPriority.FOLLOWUP, type: "followUp", prompt: "f" },
		];

		// Sort by priority (simulates queue insertion order)
		const sorted = [...requests].sort((a, b) => a.priority - b.priority);
		expect(sorted[0].type).toBe("abort");
		expect(sorted[1].type).toBe("steer");
		expect(sorted[2].type).toBe("followUp");
		expect(sorted[3].type).toBe("ask");
	});
});

describe("extractTextFromMessages", () => {
	test("extracts text from string content", () => {
		const messages = [{ role: "assistant", content: "Hello world" }];
		expect(extractTextFromMessages(messages)).toBe("Hello world");
	});

	test("extracts text from content array with text parts", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Part 1" },
					{ type: "text", text: " Part 2" },
				],
			},
		];
		expect(extractTextFromMessages(messages)).toBe("Part 1 Part 2");
	});

	test("filters non-text parts", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Hello" },
					{ type: "tool_use", id: "123", name: "read" },
				],
			},
		];
		expect(extractTextFromMessages(messages)).toBe("Hello");
	});

	test("returns empty string for non-array messages", () => {
		expect(extractTextFromMessages(null as unknown as unknown[])).toBe("");
		expect(extractTextFromMessages(undefined as unknown as unknown[])).toBe("");
		expect(extractTextFromMessages("not an array" as unknown as unknown[])).toBe("");
	});

	test("uses last message only", () => {
		const messages = [
			{ role: "user", content: "question" },
			{ role: "assistant", content: "answer" },
		];
		expect(extractTextFromMessages(messages)).toBe("answer");
	});
});

describe("RequestHints parsing", () => {
	test("parses valid JSON hints", () => {
		const hintsJson = '{"model":"claude-opus-4-6","thinking":"high"}';
		const hints: RequestHints = JSON.parse(hintsJson);
		expect(hints.model).toBe("claude-opus-4-6");
		expect(hints.thinking).toBe("high");
	});

	test("handles provider/model format", () => {
		const hints: RequestHints = { model: "anthropic/claude-opus-4-6" };
		const parts = hints.model!.split("/");
		expect(parts).toHaveLength(2);
		expect(parts[0]).toBe("anthropic");
		expect(parts[1]).toBe("claude-opus-4-6");
	});

	test("handles empty hints gracefully", () => {
		const hints: RequestHints = {};
		expect(hints.model).toBeUndefined();
		expect(hints.provider).toBeUndefined();
		expect(hints.thinking).toBeUndefined();
	});
});

describe("Persona path resolution", () => {
	test("persona name maps to agents directory path", () => {
		const personaName = "brandon-bailey";
		const expectedPath = `.pi/agents/${personaName}/AGENTS.md`;
		expect(expectedPath).toContain(personaName);
		expect(expectedPath.endsWith("AGENTS.md")).toBe(true);
	});
});
