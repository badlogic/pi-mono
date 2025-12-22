/**
 * Custom Model Selection
 *
 * Shows how to select a specific model and thinking level.
 */

import { createAgentSession, findModel, discoverAvailableModels } from "../../src/index.js";

// Option 1: Find a specific model by provider/id
const { model: sonnet } = findModel("anthropic", "claude-sonnet-4-20250514");
if (sonnet) {
	console.log(`Found model: ${sonnet.provider}/${sonnet.id}`);
}

// Option 2: Pick from available models (have valid API keys)
const available = await discoverAvailableModels();
console.log(
	"Available models:",
	available.map((m) => `${m.provider}/${m.id}`),
);

if (available.length > 0) {
	const { session } = await createAgentSession({
		model: available[0],
		thinkingLevel: "medium", // off, low, medium, high
	});

	session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			process.stdout.write(event.assistantMessageEvent.delta);
		}
	});

	await session.prompt("Say hello in one sentence.");
	console.log();
}
