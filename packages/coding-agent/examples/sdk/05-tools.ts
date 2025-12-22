/**
 * Tools Configuration
 *
 * Use built-in tool sets, individual tools, or add custom tools.
 */

import { Type } from "@sinclair/typebox";
import {
	createAgentSession,
	discoverCustomTools,
	SessionManager,
	codingTools, // read, bash, edit, write (default)
	readOnlyTools, // read, bash
	readTool,
	bashTool,
	grepTool,
	type CustomAgentTool,
} from "../../src/index.js";

// Read-only mode (no edit/write)
const { session: readOnly } = await createAgentSession({
	tools: readOnlyTools,
	sessionManager: SessionManager.inMemory(),
});
console.log("Read-only session created");

// Custom tool selection
const { session: custom } = await createAgentSession({
	tools: [readTool, bashTool, grepTool],
	sessionManager: SessionManager.inMemory(),
});
console.log("Custom tools session created");

// Inline custom tool (needs TypeBox schema)
const weatherTool: CustomAgentTool = {
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
