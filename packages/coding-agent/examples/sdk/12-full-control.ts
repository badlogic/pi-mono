/**
 * Full Control
 *
 * Replace everything - no discovery, explicit configuration.
 * Still uses OAuth from ~/.pi/agent for convenience.
 */

import { Type } from "@sinclair/typebox";
import {
	createAgentSession,
	configureOAuthStorage,
	defaultGetApiKey,
	findModel,
	SessionManager,
	SettingsManager,
	readTool,
	bashTool,
	type HookFactory,
	type CustomAgentTool,
} from "../../src/index.js";
import { getAgentDir } from "../../src/config.js";

// Use OAuth from default location
configureOAuthStorage(getAgentDir());

// Custom API key with fallback
const getApiKey = async (model: { provider: string }) => {
	if (model.provider === "anthropic" && process.env.MY_ANTHROPIC_KEY) {
		return process.env.MY_ANTHROPIC_KEY;
	}
	return defaultGetApiKey()(model as any);
};

// Inline hook
const auditHook: HookFactory = (api) => {
	api.on("tool_call", async (event) => {
		console.log(`[Audit] ${event.toolName}`);
		return undefined;
	});
};

// Inline custom tool
const statusTool: CustomAgentTool = {
	name: "status",
	label: "Status",
	description: "Get system status",
	parameters: Type.Object({}),
	execute: async () => ({
		content: [{ type: "text", text: `Uptime: ${process.uptime()}s, Node: ${process.version}` }],
		details: {},
	}),
};

const { model } = findModel("anthropic", "claude-sonnet-4-20250514");
if (!model) throw new Error("Model not found");

// In-memory settings with overrides
const settingsManager = SettingsManager.inMemory({
	compaction: { enabled: false },
	retry: { enabled: true, maxRetries: 2 },
});

const { session } = await createAgentSession({
	cwd: process.cwd(),
	agentDir: "/tmp/my-agent",

	model,
	thinkingLevel: "off",
	getApiKey,

	systemPrompt: `You are a minimal assistant.
Available: read, bash, status. Be concise.`,

	tools: [readTool, bashTool],
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
