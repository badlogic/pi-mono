/**
 * Hooks Configuration
 *
 * Hooks intercept agent events for logging, blocking, or modification.
 */

import { createAgentSession, discoverHooks, SessionManager, type HookFactory } from "../../src/index.js";

// Logging hook
const loggingHook: HookFactory = (api) => {
	api.on("agent_start", async () => {
		console.log("[Hook] Agent starting");
	});

	api.on("tool_call", async (event) => {
		console.log(`[Hook] Tool: ${event.toolName}`);
		return undefined; // Don't block
	});

	api.on("agent_end", async (event) => {
		console.log(`[Hook] Done, ${event.messages.length} messages`);
	});
};

// Blocking hook (returns { block: true, reason: "..." })
const safetyHook: HookFactory = (api) => {
	api.on("tool_call", async (event) => {
		if (event.toolName === "bash") {
			const cmd = (event.input as { command?: string }).command ?? "";
			if (cmd.includes("rm -rf")) {
				return { block: true, reason: "Dangerous command blocked" };
			}
		}
		return undefined;
	});
};

// Use inline hooks
const { session } = await createAgentSession({
	hooks: [{ factory: loggingHook }, { factory: safetyHook }],
	sessionManager: SessionManager.inMemory(),
});

session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

await session.prompt("List files in the current directory.");
console.log();

// Disable all hooks:
// hooks: []

// Merge with discovered hooks:
// const discovered = await discoverHooks();
// hooks: [...discovered, { factory: myHook }]

// Add paths without replacing discovery:
// additionalHookPaths: ["/extra/hooks"]
