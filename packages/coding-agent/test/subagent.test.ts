import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@apholdings/jensen-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAgents } from "../examples/extensions/subagent/agents.js";
import { buildSubagentInvocation, createSubagentTool } from "../examples/extensions/subagent/index.js";
import type { ExtensionContext, ExtensionUIContext } from "../src/core/extensions/types.js";

const AGENT_DIR_ENV = "JENSEN_CODING_AGENT_DIR";

function createAssistantMessage(
	parts: Array<
		{ type: "text"; text: string } | { type: "toolCall"; name: string; arguments: Record<string, unknown> }
	>,
	overrides?: Partial<Message>,
): Message {
	return {
		role: "assistant",
		content: parts,
		timestamp: Date.now(),
		...overrides,
	} as Message;
}

function createUi(): ExtensionUIContext {
	return {
		select: async () => undefined,
		confirm: async () => false,
		input: async () => undefined,
		notify: () => {},
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async () => {
			throw new Error("not implemented");
		},
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		editor: async () => undefined,
		setEditorComponent: () => {},
		theme: {} as ExtensionUIContext["theme"],
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: true }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}

function createContext(cwd: string): ExtensionContext {
	return {
		ui: createUi(),
		hasUI: false,
		cwd,
		sessionManager: {} as ExtensionContext["sessionManager"],
		modelRegistry: {} as ExtensionContext["modelRegistry"],
		model: undefined,
		isIdle: () => true,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
	};
}

function isToolError(result: unknown): boolean {
	return typeof result === "object" && result !== null && "isError" in result && result.isError === true;
}

describe("subagent extension", () => {
	let tempDir: string;
	let agentDir: string;
	let repoDir: string;
	let previousAgentDir: string | undefined;
	let previousArgv: string[];

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jensen-subagent-test-"));
		agentDir = path.join(tempDir, "agent");
		repoDir = path.join(tempDir, "repo");
		fs.mkdirSync(path.join(agentDir, "agents"), { recursive: true });
		fs.mkdirSync(repoDir, { recursive: true });
		previousAgentDir = process.env[AGENT_DIR_ENV];
		process.env[AGENT_DIR_ENV] = agentDir;
		previousArgv = [...process.argv];
	});

	afterEach(() => {
		if (previousAgentDir === undefined) {
			delete process.env[AGENT_DIR_ENV];
		} else {
			process.env[AGENT_DIR_ENV] = previousAgentDir;
		}
		process.argv = previousArgv;
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("discovery loads tester.md from user scope", () => {
		const testerPath = path.join(agentDir, "agents", "tester.md");
		fs.writeFileSync(
			testerPath,
			`---
name: tester
description: A simple test agent
tools: read, grep, find, ls
model: openrouter/hunter-alpha
---

You are a test agent. Reply exactly with SUBAGENT_OK.
`,
		);

		const result = discoverAgents(repoDir, "user");

		expect(result.errors).toEqual([]);
		expect(result.agents).toHaveLength(1);
		expect(result.agents[0]?.name).toBe("tester");
		expect(result.agents[0]?.source).toBe("user");
		expect(result.agents[0]?.filePath).toBe(path.resolve(testerPath));
	});

	it("single-mode user-scope tester returns SUBAGENT_OK exactly", async () => {
		fs.writeFileSync(
			path.join(agentDir, "agents", "tester.md"),
			`---
name: tester
description: A simple test agent
tools: read, grep, find, ls
model: openrouter/hunter-alpha
---

You are a test agent. Reply exactly with SUBAGENT_OK.
`,
		);

		const tool = createSubagentTool({
			runSubagent: async ({ onMessage }) => {
				onMessage(
					createAssistantMessage([
						{ type: "text", text: "" },
						{ type: "text", text: "SUBAGENT_OK" },
					]),
				);
				return { exitCode: 0, stderr: "" };
			},
		});

		const result = await tool.execute(
			"call-1",
			{ agent: "tester", task: "Reply exactly with SUBAGENT_OK", agentScope: "user" },
			undefined,
			undefined,
			createContext(repoDir),
		);

		expect(isToolError(result)).toBe(false);
		expect(result.content[0]).toEqual({ type: "text", text: "SUBAGENT_OK" });
	});

	it("unknown agent produces a true unknown-agent error", async () => {
		fs.writeFileSync(
			path.join(agentDir, "agents", "tester.md"),
			`---
name: tester
description: A simple test agent
---

You are a test agent.
`,
		);

		const tool = createSubagentTool({
			runSubagent: async () => ({ exitCode: 0, stderr: "" }),
		});

		const result = await tool.execute(
			"call-2",
			{ agent: "missing", task: "Reply exactly with SUBAGENT_OK", agentScope: "user" },
			undefined,
			undefined,
			createContext(repoDir),
		);

		expect(isToolError(result)).toBe(true);
		expect(result.content[0]?.type).toBe("text");
		expect((result.content[0] as { type: "text"; text: string }).text).toContain('Unknown agent: "missing"');
		expect((result.content[0] as { type: "text"; text: string }).text).not.toContain("discovery failed");
	});

	it("parse failure in a bad agent file surfaces path and parse reason", async () => {
		const badPath = path.join(agentDir, "agents", "tester.md");
		fs.writeFileSync(
			badPath,
			`---
name: tester
description: [unterminated
---

Broken agent file.
`,
		);

		const tool = createSubagentTool({
			runSubagent: async () => ({ exitCode: 0, stderr: "" }),
		});

		const result = await tool.execute(
			"call-3",
			{ agent: "tester", task: "Reply exactly with SUBAGENT_OK", agentScope: "user" },
			undefined,
			undefined,
			createContext(repoDir),
		);

		expect(isToolError(result)).toBe(true);
		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain(path.resolve(badPath));
		expect(text).toContain("Agent discovery failed");
		expect(text).not.toContain('Unknown agent: "tester"');
	});

	it("child launch failure surfaces a concrete error, not no output", async () => {
		fs.writeFileSync(
			path.join(agentDir, "agents", "tester.md"),
			`---
name: tester
description: A simple test agent
---

You are a test agent.
`,
		);

		const tool = createSubagentTool({
			runSubagent: async () => ({ exitCode: 1, stderr: "", launchError: "spawn jensen ENOENT" }),
		});

		const result = await tool.execute(
			"call-4",
			{ agent: "tester", task: "Reply exactly with SUBAGENT_OK", agentScope: "user" },
			undefined,
			undefined,
			createContext(repoDir),
		);

		expect(isToolError(result)).toBe(true);
		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("spawn jensen ENOENT");
		expect(text).not.toContain("(no output)");
	});

	it("empty assistant output surfaces a specific empty-output diagnostic", async () => {
		fs.writeFileSync(
			path.join(agentDir, "agents", "tester.md"),
			`---
name: tester
description: A simple test agent
---

You are a test agent.
`,
		);

		const tool = createSubagentTool({
			runSubagent: async ({ onMessage }) => {
				onMessage(createAssistantMessage([{ type: "toolCall", name: "read", arguments: { path: "file.ts" } }]));
				return { exitCode: 0, stderr: "" };
			},
		});

		const result = await tool.execute(
			"call-5",
			{ agent: "tester", task: "Reply exactly with SUBAGENT_OK", agentScope: "user" },
			undefined,
			undefined,
			createContext(repoDir),
		);

		expect(isToolError(result)).toBe(true);
		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("Final assistant output was empty");
		expect(text).toContain("contained no text parts");
	});

	it("Windows path normalization does not duplicate repo paths", () => {
		process.argv = [process.argv[0], "D:\\Documents\\software\\jensen-code\\packages\\coding-agent\\dist\\cli.js"];

		const invocation = buildSubagentInvocation(
			"D:\\Documents\\software\\jensen-code",
			{
				name: "tester",
				description: "A simple test agent",
				source: "user",
				systemPrompt: "Reply exactly with SUBAGENT_OK.",
				filePath: "C:\\Users\\sparrow\\.jensen\\agent\\agents\\tester.md",
			},
			"Reply exactly with SUBAGENT_OK",
			"D:\\Documents\\software\\jensen-code\\packages\\coding-agent",
		);

		expect(invocation.command).toBe(process.execPath);
		expect(invocation.args[0]).toBe(
			path.resolve("D:\\Documents\\software\\jensen-code\\packages\\coding-agent\\dist\\cli.js"),
		);
		expect(invocation.cwd).toBe(path.resolve("D:\\Documents\\software\\jensen-code\\packages\\coding-agent"));
		expect(invocation.cwd.includes("jensen-code\\jensen-code")).toBe(false);
	});
});
