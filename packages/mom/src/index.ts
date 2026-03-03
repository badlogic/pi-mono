/**
 * @mariozechner/pi-mom — public API
 *
 * Re-exports the types and functions needed to build extensions
 * and start the bot programmatically.
 */

// Re-export upstream types so extensions don't need direct dependencies
// on pi-agent-core, pi-ai, or pi-coding-agent (avoids duplicate type issues)
export { Agent, type AgentMessage, type AgentTool } from "@mariozechner/pi-agent-core";
export { getModel } from "@mariozechner/pi-ai";
export {
	AgentSession,
	AuthStorage,
	convertToLlm,
	createExtensionRuntime,
	ModelRegistry,
	type ResourceLoader,
	SessionManager,
} from "@mariozechner/pi-coding-agent";
// Extension interface
export type { AgentExtension, AgentRunner } from "./agent.js";

// Context and settings (needed by extensions that create AgentSessions)
export { MomSettingsManager } from "./context.js";

// Logging
export * as log from "./log.js";
export { createExecutor, type Executor, type SandboxConfig } from "./sandbox.js";
// Core entry point
export { type MomStartOptions, startMom } from "./start.js";
// Tools and sandbox (needed by extensions that create worker agents)
export { createMomTools } from "./tools/index.js";
