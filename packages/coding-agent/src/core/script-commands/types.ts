/**
 * Script command types.
 *
 * Script commands are TypeScript modules that define executable slash commands.
 * Unlike .md file commands that inject text, script commands run custom logic.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";

/** Options for complete() API call */
export interface CompleteOptions {
	/** Model ID to use (e.g., "claude-haiku-4-5", "gpt-4o-mini"). Defaults to current session model. */
	model?: string;
	/** System prompt for the completion */
	systemPrompt?: string;
	/** Maximum tokens in response */
	maxTokens?: number;
	/** AbortSignal to cancel the request */
	signal?: AbortSignal;
}

/** API passed to script command factory */
export interface CommandAPI {
	/** Current working directory */
	cwd: string;
	/** Get text content of the last assistant message, or null if none */
	getLastAssistantText(): string | null;
	/** Set the editor text content */
	setEditorText(text: string): void;
	/** Get current editor text content */
	getEditorText(): string;
	/**
	 * Make an LLM completion call.
	 * Uses the session's model registry to resolve API keys.
	 * @param prompt The user prompt to send
	 * @param options Optional model, system prompt, max tokens
	 * @returns The assistant message response
	 */
	complete(prompt: string, options?: CompleteOptions): Promise<AssistantMessage>;
	/** Show a status message */
	showStatus(message: string): void;
	/** Show an error message */
	showError(message: string): void;
	/** Copy text to clipboard */
	copyToClipboard(text: string): void;
}

/** Script command definition */
export interface ScriptCommand {
	/** Description shown in autocomplete */
	description: string;
	/** Execute the command with parsed arguments */
	execute(args: string[]): Promise<void> | void;
}

/** Factory function that creates a script command */
export type ScriptCommandFactory = (api: CommandAPI) => ScriptCommand | Promise<ScriptCommand>;

/** Loaded script command with metadata */
export interface LoadedScriptCommand {
	/** Command name (filename without extension) */
	name: string;
	/** Description for autocomplete */
	description: string;
	/** Source indicator (e.g., "(user)", "(project)") */
	source: string;
	/** The execute function */
	execute: (args: string[]) => Promise<void> | void;
	/** Original file path */
	path: string;
}

/** Result from loading script commands */
export interface ScriptCommandsLoadResult {
	commands: LoadedScriptCommand[];
	errors: Array<{ path: string; error: string }>;
	/** Set the API callbacks. Call when mode initializes. */
	setAPI(api: CommandAPI): void;
}
