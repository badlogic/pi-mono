/**
 * Tools Configuration
 *
 * Use built-in tool sets, individual tools, or add custom tools.
 *
 * IMPORTANT: When using a custom `cwd`, you must use the tool factory functions
 * (createCodingTools, createReadOnlyTools, createReadTool, etc.) to ensure
 * tools resolve paths relative to your cwd, not process.cwd().
 */

import { Type } from "@sinclair/typebox";
import {
	bashTool, // read, bash, edit, write - uses process.cwd()
	type CustomTool,
	createAgentSession,
	createBashTool,
	createCodingTools, // Factory: creates tools for specific cwd
	createGrepTool,
	createReadTool,
	grepTool,
	readOnlyTools, // read, grep, find, ls - uses process.cwd()
	readTool,
	SessionManager,
} from "../../src/index.js";

// Read-only mode (no edit/write) - uses process.cwd()
await createAgentSession({
	tools: readOnlyTools,
	sessionManager: SessionManager.inMemory(),
});
console.log("Read-only session created");

// Custom tool selection - uses process.cwd()
await createAgentSession({
	tools: [readTool, bashTool, grepTool],
	sessionManager: SessionManager.inMemory(),
});
console.log("Custom tools session created");

// With custom cwd - MUST use factory functions!
const customCwd = "/path/to/project";
await createAgentSession({
	cwd: customCwd,
	tools: createCodingTools(customCwd), // Tools resolve paths relative to customCwd
	sessionManager: SessionManager.inMemory(),
});
console.log("Custom cwd session created");

// Or pick specific tools for custom cwd
await createAgentSession({
	cwd: customCwd,
	tools: [createReadTool(customCwd), createBashTool(customCwd), createGrepTool(customCwd)],
	sessionManager: SessionManager.inMemory(),
});
console.log("Specific tools with custom cwd session created");

// Inline custom tool (needs TypeBox schema)
const weatherTool: CustomTool = {
	name: "get_weather",
	label: "Get Weather",
	description: "Get current weather for a city",
	parameters: Type.Object({
		city: Type.String({ description: "City name" }),
	}),
	execute: async (_toolCallId, params) => ({
		content: [{ type: "text", text: `Weather in ${(params as { city: string }).city}: 22°C, sunny` }],
		details: {},
	}),
};

const { session } = await createAgentSession({
	customTools: [{ tool: weatherTool }],
	sessionManager: SessionManager.inMemory(),
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("What's the weather in Tokyo?");
console.log();

// Merge with discovered tools from cwd/.pi/tools and ~/.pi/agent/tools:
// const discovered = await discoverCustomTools();
// customTools: [...discovered, { tool: myTool }]

// Or add paths without replacing discovery:
// additionalCustomToolPaths: ["/extra/tools"]
