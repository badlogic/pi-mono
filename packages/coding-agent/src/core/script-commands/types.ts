/**
 * Script command types.
 *
 * Script commands are TypeScript modules that define executable slash commands.
 * Unlike .md file commands that inject text, script commands run custom logic.
 */

import type { ToolAPI } from "../custom-tools/types.js";

/** Script command definition */
export interface ScriptCommand {
	/** Description shown in autocomplete */
	description: string;
	/** Execute the command with parsed arguments */
	execute(args: string[]): Promise<void> | void;
}

/** Factory function that creates a script command */
export type ScriptCommandFactory = (api: ToolAPI) => ScriptCommand | Promise<ScriptCommand>;

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
	setAPI(api: ToolAPI): void;
}
