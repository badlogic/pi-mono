export type SlashCommandSource = "extension" | "prompt" | "skill";

export type SlashCommandLocation = "user" | "project" | "path";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	location?: SlashCommandLocation;
	path?: string;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	// Discovery & Help
	{ name: "help", description: "Show all commands grouped by category" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },

	// Session Management
	{ name: "new", description: "Start a new session" },
	{ name: "resume", description: "Resume a different session" },
	{ name: "fork", description: "Create a new fork from a previous message" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "export", description: "Export session to HTML file" },
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "context", description: "Show context usage and token counts" },

	// Configuration
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "tools", description: "Enable/disable tools" },

	// Extensibility
	{ name: "extensions", description: "List loaded extensions" },
	{ name: "skills", description: "List available skills" },
	{ name: "prompts", description: "List prompt templates" },

	// Authentication
	{ name: "login", description: "Login with OAuth provider" },
	{ name: "logout", description: "Logout from OAuth provider" },

	// System
	{ name: "reload", description: "Reload extensions, skills, prompts, and themes" },
	{ name: "changelog", description: "Show changelog entries" },
];
