/**
 * Settings Configuration
 *
 * Override settings using SettingsManager.
 */

import { createAgentSession, SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";

// Load current settings (merged global + project)
const settingsManagerFromDisk = SettingsManager.create();
console.log("Current settings:", JSON.stringify(settingsManagerFromDisk.getGlobalSettings(), null, 2));

// Override specific settings
const settingsManager = SettingsManager.create();
settingsManager.applyOverrides({
	compaction: { enabled: false },
	retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
});

await createAgentSession({
	settingsManager,
	sessionManager: SessionManager.inMemory(),
});

console.log("Session created with custom settings");

// For testing without file I/O:
const inMemorySettings = SettingsManager.inMemory({
	compaction: { enabled: false },
	retry: { enabled: false },
});

await createAgentSession({
	settingsManager: inMemorySettings,
	sessionManager: SessionManager.inMemory(),
});

console.log("Test session created with in-memory settings");
