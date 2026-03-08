import chalk from "chalk";
import { APP_NAME } from "../config.js";
import {
	addSSHHost,
	getSSHConfigPath,
	readSSHConfigFile,
	removeSSHHost,
	type SSHHostConfig,
	type SSHScope,
} from "./ssh-config.js";

type SSHAction = "add" | "remove" | "list";

interface SSHCommandFlags {
	json?: boolean;
	host?: string;
	user?: string;
	port?: string;
	key?: string;
	desc?: string;
	compat?: boolean;
	scope?: SSHScope;
}

interface SSHCommandArgs {
	action: SSHAction;
	args: string[];
	flags: SSHCommandFlags;
}

function printSSHHelp(): void {
	console.log(`${APP_NAME} ssh

Usage:
  ${APP_NAME} ssh list [--json]
  ${APP_NAME} ssh add <name> --host <address> [--user <user>] [--port <port>] [--key <path>] [--desc <text>] [--compat] [--scope project|user]
  ${APP_NAME} ssh remove <name> [--scope project|user]

Options:
  --json                 Output JSON for list
  --host <address>       SSH host or IP
  --user <user>          SSH username
  --port <port>          SSH port
  --key <path>           Identity key path
  --desc <text>          Description
  --compat               Compatibility mode flag
  --scope <scope>        Config scope: project or user
  --help                 Show this help
`);
}

function parseSSHCommandArgs(args: string[]): SSHCommandArgs | undefined {
	const [maybeAction, ...rest] = args;
	if (!maybeAction || maybeAction === "--help" || maybeAction === "-h") {
		printSSHHelp();
		return undefined;
	}
	if (maybeAction !== "add" && maybeAction !== "remove" && maybeAction !== "list") {
		console.error(chalk.red(`Unknown ssh action: ${maybeAction}`));
		console.error(chalk.dim(`Usage: ${APP_NAME} ssh <add|remove|list> [...]`));
		process.exitCode = 1;
		return undefined;
	}

	const parsed: SSHCommandArgs = { action: maybeAction, args: [], flags: {} };
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--help" || arg === "-h") {
			printSSHHelp();
			return undefined;
		}
		if (arg === "--json") {
			parsed.flags.json = true;
			continue;
		}
		if (arg === "--compat") {
			parsed.flags.compat = true;
			continue;
		}
		if (
			arg === "--host" ||
			arg === "--user" ||
			arg === "--port" ||
			arg === "--key" ||
			arg === "--desc" ||
			arg === "--scope"
		) {
			const value = rest[i + 1];
			if (value === undefined) {
				console.error(chalk.red(`Missing value for ${arg}`));
				process.exitCode = 1;
				return undefined;
			}
			i += 1;
			if (arg === "--host") parsed.flags.host = value;
			else if (arg === "--user") parsed.flags.user = value;
			else if (arg === "--port") parsed.flags.port = value;
			else if (arg === "--key") parsed.flags.key = value;
			else if (arg === "--desc") parsed.flags.desc = value;
			else if (arg === "--scope") {
				if (value !== "project" && value !== "user") {
					console.error(chalk.red(`Invalid scope "${value}". Use "project" or "user".`));
					process.exitCode = 1;
					return undefined;
				}
				parsed.flags.scope = value;
			}
			continue;
		}
		if (arg.startsWith("-")) {
			console.error(chalk.red(`Unknown option for "${APP_NAME} ssh": ${arg}`));
			process.exitCode = 1;
			return undefined;
		}
		parsed.args.push(arg);
	}
	return parsed;
}

function printHosts(hosts: Record<string, SSHHostConfig>): void {
	for (const [name, config] of Object.entries(hosts)) {
		const parts = [chalk.cyan(name), config.host];
		if (config.username) parts.push(chalk.dim(config.username));
		if (config.port && config.port !== 22) parts.push(chalk.dim(`port:${config.port}`));
		if (config.keyPath) parts.push(chalk.dim(config.keyPath));
		if (config.description) parts.push(chalk.dim(`- ${config.description}`));
		console.log(`  ${parts.join("  ")}`);
	}
}

async function handleList(flags: SSHCommandFlags): Promise<void> {
	const [projectConfig, userConfig] = await Promise.all([
		readSSHConfigFile(getSSHConfigPath("project")),
		readSSHConfigFile(getSSHConfigPath("user")),
	]);
	const projectHosts = projectConfig.hosts ?? {};
	const userHosts = userConfig.hosts ?? {};

	if (flags.json) {
		console.log(JSON.stringify({ project: projectHosts, user: userHosts }, null, 2));
		return;
	}

	if (Object.keys(projectHosts).length === 0 && Object.keys(userHosts).length === 0) {
		console.log(chalk.dim("No SSH hosts configured"));
		console.log(chalk.dim(`Add one with: ${APP_NAME} ssh add <name> --host <address>`));
		return;
	}

	if (Object.keys(projectHosts).length > 0) {
		console.log(chalk.bold(`Project SSH Hosts (${getSSHConfigPath("project")}):`));
		printHosts(projectHosts);
	}
	if (Object.keys(projectHosts).length > 0 && Object.keys(userHosts).length > 0) {
		console.log("");
	}
	if (Object.keys(userHosts).length > 0) {
		console.log(chalk.bold(`User SSH Hosts (${getSSHConfigPath("user")}):`));
		printHosts(userHosts);
	}
}

async function handleAdd(cmd: SSHCommandArgs): Promise<void> {
	const name = cmd.args[0];
	if (!name) {
		console.error(chalk.red("Error: Host name required"));
		console.error(chalk.dim(`Usage: ${APP_NAME} ssh add <name> --host <address>`));
		process.exitCode = 1;
		return;
	}
	if (!cmd.flags.host) {
		console.error(chalk.red("Error: --host is required"));
		process.exitCode = 1;
		return;
	}
	if (cmd.flags.port !== undefined) {
		const port = Number.parseInt(cmd.flags.port, 10);
		if (Number.isNaN(port) || port < 1 || port > 65535) {
			console.error(chalk.red("Error: Port must be an integer between 1 and 65535"));
			process.exitCode = 1;
			return;
		}
	}

	const hostConfig: SSHHostConfig = { host: cmd.flags.host };
	if (cmd.flags.user) hostConfig.username = cmd.flags.user;
	if (cmd.flags.port) hostConfig.port = Number.parseInt(cmd.flags.port, 10);
	if (cmd.flags.key) hostConfig.keyPath = cmd.flags.key;
	if (cmd.flags.desc) hostConfig.description = cmd.flags.desc;
	if (cmd.flags.compat) hostConfig.compat = true;

	const scope = cmd.flags.scope ?? "project";
	try {
		await addSSHHost(getSSHConfigPath(scope), name, hostConfig);
		console.log(chalk.green(`Added SSH host "${name}" to ${scope} config`));
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = 1;
	}
}

async function handleRemove(cmd: SSHCommandArgs): Promise<void> {
	const name = cmd.args[0];
	if (!name) {
		console.error(chalk.red("Error: Host name required"));
		console.error(chalk.dim(`Usage: ${APP_NAME} ssh remove <name> [--scope project|user]`));
		process.exitCode = 1;
		return;
	}
	const scope = cmd.flags.scope ?? "project";
	try {
		await removeSSHHost(getSSHConfigPath(scope), name);
		console.log(chalk.green(`Removed SSH host "${name}" from ${scope} config`));
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = 1;
	}
}

export async function runSSHCommand(args: string[]): Promise<void> {
	const parsed = parseSSHCommandArgs(args);
	if (!parsed) return;
	if (process.exitCode === 1) return;

	switch (parsed.action) {
		case "add":
			await handleAdd(parsed);
			return;
		case "remove":
			await handleRemove(parsed);
			return;
		case "list":
			await handleList(parsed.flags);
			return;
	}
}
