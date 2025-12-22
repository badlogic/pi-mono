/**
 * Settings Configuration
 *
 * Override settings from agentDir/settings.json.
 */

import { createAgentSession, loadSettings, SessionManager } from "../../src/index.js";

// Load current settings
const settings = loadSettings();
console.log("Current settings:", JSON.stringify(settings, null, 2));

// Override specific settings
const { session } = await createAgentSession({
	settings: {
		// Disable auto-compaction
		compaction: { enabled: false },

		// Custom retry behavior
		retry: {
			enabled: true,
			maxRetries: 5,
			baseDelayMs: 1000,
		},

		// Terminal options
		terminal: { showImages: true },
		hideThinkingBlock: true,
	},
	sessionManager: SessionManager.inMemory(),
});

console.log("Session created with custom settings");
