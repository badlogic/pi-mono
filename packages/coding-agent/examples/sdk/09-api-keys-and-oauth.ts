/**
 * API Keys and OAuth
 *
 * Configure API key resolution via AuthStorage and ModelRegistry.
 */

import {
	AuthStorage,
	createAgentSession,
	discoverAuthStorage,
	discoverModels,
	ModelRegistry,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

// Default: discoverAuthStorage() uses ~/.pi/agent/auth.json
// discoverModels() loads built-in + custom models from ~/.pi/agent/models.json
const authStorage = discoverAuthStorage();
const modelRegistry = discoverModels(authStorage);

await createAgentSession({
	sessionManager: SessionManager.inMemory(),
	authStorage,
	modelRegistry,
});
console.log("Session with default auth storage and model registry");

// Custom auth storage location
const customAuthStorage = new AuthStorage("/tmp/my-app/auth.json");
const customModelRegistry = new ModelRegistry(customAuthStorage, "/tmp/my-app/models.json");

await createAgentSession({
	sessionManager: SessionManager.inMemory(),
	authStorage: customAuthStorage,
	modelRegistry: customModelRegistry,
});
console.log("Session with custom auth storage location");

// Runtime API key override (not persisted to disk)
authStorage.setRuntimeApiKey("anthropic", "sk-my-temp-key");
await createAgentSession({
	sessionManager: SessionManager.inMemory(),
	authStorage,
	modelRegistry,
});
console.log("Session with runtime API key override");

// No models.json - only built-in models
const simpleRegistry = new ModelRegistry(authStorage); // null = no models.json
await createAgentSession({
	sessionManager: SessionManager.inMemory(),
	authStorage,
	modelRegistry: simpleRegistry,
});
console.log("Session with only built-in models");
