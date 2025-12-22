/**
 * Custom System Prompt
 *
 * Shows how to replace or modify the default system prompt.
 */

import { createAgentSession, SessionManager } from "../../src/index.js";

// Option 1: Replace prompt entirely
const { session: session1 } = await createAgentSession({
	systemPrompt: `You are a helpful assistant that speaks like a pirate.
Always end responses with "Arrr!"`,
	sessionManager: SessionManager.inMemory(),
});

session1.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

console.log("=== Replace prompt ===");
await session1.prompt("What is 2 + 2?");
console.log("\n");

// Option 2: Modify default prompt (receives default, returns modified)
const { session: session2 } = await createAgentSession({
	systemPrompt: (defaultPrompt) => `${defaultPrompt}

## Additional Instructions
- Always be concise
- Use bullet points when listing things`,
	sessionManager: SessionManager.inMemory(),
});

session2.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

console.log("=== Modify prompt ===");
await session2.prompt("List 3 benefits of TypeScript.");
console.log();
