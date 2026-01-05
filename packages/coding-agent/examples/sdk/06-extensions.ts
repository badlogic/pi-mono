/**
 * Extensions Configuration
 *
 * Extensions intercept agent events and can register custom tools.
 * They provide a unified system for extensions, custom tools, commands, and more.
 *
 * Extension files are discovered from:
 * - ~/.pi/agent/extensions/
 * - <cwd>/.pi/extensions/
 * - Paths specified in settings.json "extensions" array
 * - Paths passed via --extension CLI flag
 *
 * An extension is a TypeScript file that exports a default function:
 *   export default function (pi: ExtensionAPI) { ... }
 */

import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

// Extensions are loaded from disk, not passed inline to createAgentSession.
// Use the discovery mechanism:
//   1. Place extension files in ~/.pi/agent/extensions/ or .pi/extensions/
//   2. Add paths to settings.json: { "extensions": ["./my-extension.ts"] }
//   3. Use --extension flag: pi --extension ./my-extension.ts

// To add additional extension paths beyond discovery:
const { session } = await createAgentSession({
	additionalExtensionPaths: ["./my-logging-extension.ts", "./my-safety-extension.ts"],
	sessionManager: SessionManager.inMemory(),
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("List files in the current directory.");
console.log();

// Example extension file (./my-logging-extension.ts):
/*
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("agent_start", async () => {
		console.log("[Extension] Agent starting");
	});

	pi.on("tool_call", async (event) => {
		console.log(\`[Extension] Tool: \${event.toolName}\`);
		// Return { block: true, reason: "..." } to block execution
		return undefined;
	});

	pi.on("agent_end", async (event) => {
		console.log(\`[Extension] Done, \${event.messages.length} messages\`);
	});

	// Register a custom tool
	pi.registerTool({
		name: "my_tool",
		label: "My Tool",
		description: "Does something useful",
		parameters: Type.Object({
			input: Type.String(),
		}),
		execute: async (_toolCallId, params, _onUpdate, _ctx, _signal) => ({
			content: [{ type: "text", text: \`Processed: \${params.input}\` }],
			details: {},
		}),
	});

	// Register a command
	pi.registerCommand("mycommand", {
		description: "Do something",
		handler: async (args, ctx) => {
			ctx.ui.notify(\`Command executed with: \${args}\`);
		},
	});
}
*/
