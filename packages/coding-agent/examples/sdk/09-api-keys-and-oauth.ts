/**
 * API Keys and OAuth
 *
 * Configure API key resolution. Default checks: models.json, OAuth, env vars.
 */

import {
	createAgentSession,
	configureOAuthStorage,
	defaultGetApiKey,
	SessionManager,
} from "../../src/index.js";
import { getAgentDir } from "../../src/config.js";

// Default: uses env vars (ANTHROPIC_API_KEY, etc.), OAuth, and models.json
const { session: defaultSession } = await createAgentSession({
	sessionManager: SessionManager.inMemory(),
});
console.log("Session with default API key resolution");

// Custom resolver
const { session: customSession } = await createAgentSession({
	getApiKey: async (model) => {
		// Custom logic (secrets manager, database, etc.)
		if (model.provider === "anthropic") {
			return process.env.MY_ANTHROPIC_KEY;
		}
		// Fall back to default
		return defaultGetApiKey()(model);
	},
	sessionManager: SessionManager.inMemory(),
});
console.log("Session with custom API key resolver");

// Use OAuth from ~/.pi/agent while customizing everything else
configureOAuthStorage(getAgentDir()); // Must call before createAgentSession

const { session: hybridSession } = await createAgentSession({
	agentDir: "/tmp/custom-config", // Custom config location
	// But OAuth tokens still come from ~/.pi/agent/oauth.json
	systemPrompt: "You are helpful.",
	skills: [],
	sessionManager: SessionManager.inMemory(),
});
console.log("Session with OAuth from default location, custom config elsewhere");
