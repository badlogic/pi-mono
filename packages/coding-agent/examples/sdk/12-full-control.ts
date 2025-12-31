/**
 * Full Control
 *
 * Replace everything - no discovery, explicit configuration.
 *
 * IMPORTANT: When providing `tools` with a custom `cwd`, use the tool factory
 * functions (createReadTool, createBashTool, etc.) to ensure tools resolve
 * paths relative to your cwd.
 */

import { getModel } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import {
	AuthStorage,
	type CustomTool,
	createAgentSession,
	createBashTool,
	createReadTool,
	type HookFactory,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "../../src/index.js";

// Custom auth storage location
const authStorage = new AuthStorage("/tmp/my-agent/auth.json");

// Runtime API key override (not persisted)
if (process.env.MY_ANTHROPIC_KEY) {
	authStorage.setRuntimeApiKey("anthropic", process.env.MY_ANTHROPIC_KEY);
}

// Model registry with no custom models.json
const modelRegistry = new ModelRegistry(authStorage);

// Inline hook
const auditHook: HookFactory = (api) => {
	api.on("tool_call", async (event) => {
		console.log(`[Audit] ${event.toolName}`);
		return undefined;
	});
};

// Inline custom tool
const statusTool: CustomTool = {
	name: "status",
	label: "Status",
	description: "Get system status",
	parameters: Type.Object({}),
	execute: async () => ({
		content: [{ type: "text", text: `Uptime: ${process.uptime()}s, Node: ${process.version}` }],
		details: {},
	}),
};

const model = getModel("anthropic", "claude-opus-4-5");
if (!model) throw new Error("Model not found");

// In-memory settings with overrides
const settingsManager = SettingsManager.inMemory({
	compaction: { enabled: false },
	retry: { enabled: true, maxRetries: 2 },
});

// When using a custom cwd with explicit tools, use the factory functions
const cwd = process.cwd();

const { session } = await createAgentSession({
	cwd,
	agentDir: "/tmp/my-agent",
	model,
	thinkingLevel: "off",
	authStorage,
	modelRegistry,
	systemPrompt: `You are a minimal assistant.
Available: read, bash, status. Be concise.`,
	// Use factory functions with the same cwd to ensure path resolution works correctly
	tools: [createReadTool(cwd), createBashTool(cwd)],
	customTools: [{ tool: statusTool }],
	hooks: [{ factory: auditHook }],
	skills: [],
	contextFiles: [],
	slashCommands: [],
	sessionManager: SessionManager.inMemory(),
	settingsManager,
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("Get status and list files.");
console.log();
