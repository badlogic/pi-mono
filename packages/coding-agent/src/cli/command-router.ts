import { main as statsMain } from "@mariozechner/pi-stats";
import { main as launchMain } from "../main.js";
import { runAgentsCommand } from "./agents-command.js";
import { runCommitCommand } from "./commit-command.js";
import { runGrepCommand } from "./grep-command.js";
import { runJupyterCommand } from "./jupyter-command.js";
import { runPluginCommand } from "./plugin-command.js";
import { runSearchCommand } from "./search-command.js";
import { runSetupCommand } from "./setup-command.js";
import { runShellCommand } from "./shell-command.js";
import { runSSHCommand } from "./ssh-command.js";

export type CliCommandName =
	| "agents"
	| "commit"
	| "grep"
	| "jupyter"
	| "launch"
	| "plugin"
	| "search"
	| "setup"
	| "shell"
	| "ssh"
	| "stats";

export interface CliCommandResolution {
	command: CliCommandName;
	forwardedArgs: string[];
}

export interface CliCommandHandlers {
	agents: (args: string[]) => Promise<void>;
	commit: (args: string[]) => Promise<void>;
	grep: (args: string[]) => Promise<void>;
	jupyter: (args: string[]) => Promise<void>;
	launch: (args: string[]) => Promise<void>;
	plugin: (args: string[]) => Promise<void>;
	search: (args: string[]) => Promise<void>;
	setup: (args: string[]) => Promise<void>;
	shell: (args: string[]) => Promise<void>;
	ssh: (args: string[]) => Promise<void>;
	stats: (args: string[]) => Promise<void>;
}

const DEFAULT_HANDLERS: CliCommandHandlers = {
	agents: runAgentsCommand,
	commit: runCommitCommand,
	grep: runGrepCommand,
	jupyter: runJupyterCommand,
	launch: launchMain,
	plugin: runPluginCommand,
	search: runSearchCommand,
	setup: runSetupCommand,
	shell: runShellCommand,
	ssh: runSSHCommand,
	stats: statsMain,
};

export function resolveCliCommand(args: string[]): CliCommandResolution {
	const [first, ...rest] = args;
	if (!first || first.startsWith("-")) {
		return { command: "launch", forwardedArgs: args };
	}
	if (first === "launch") {
		return { command: "launch", forwardedArgs: rest };
	}
	if (first === "agents") {
		return { command: "agents", forwardedArgs: rest };
	}
	if (first === "commit") {
		return { command: "commit", forwardedArgs: rest };
	}
	if (first === "grep") {
		return { command: "grep", forwardedArgs: rest };
	}
	if (first === "jupyter") {
		return { command: "jupyter", forwardedArgs: rest };
	}
	if (first === "plugin") {
		return { command: "plugin", forwardedArgs: rest };
	}
	if (first === "q" || first === "search") {
		return { command: "search", forwardedArgs: rest };
	}
	if (first === "ssh") {
		return { command: "ssh", forwardedArgs: rest };
	}
	if (first === "setup") {
		return { command: "setup", forwardedArgs: rest };
	}
	if (first === "shell") {
		return { command: "shell", forwardedArgs: rest };
	}
	if (first === "stats") {
		return { command: "stats", forwardedArgs: rest };
	}
	return { command: "launch", forwardedArgs: args };
}

export async function runCli(args: string[], handlers: CliCommandHandlers = DEFAULT_HANDLERS): Promise<void> {
	const resolution = resolveCliCommand(args);
	await handlers[resolution.command](resolution.forwardedArgs);
}
