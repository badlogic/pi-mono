import chalk from "chalk";
import { APP_NAME } from "../config.js";
import { discoverAgents } from "../core/subagents/discovery.js";

interface AgentsCommandArgs {
	help: boolean;
	json: boolean;
}

function parseAgentsCommandArgs(args: string[]): AgentsCommandArgs {
	const parsed: AgentsCommandArgs = { help: false, json: false };
	for (const arg of args) {
		if (arg === "--help" || arg === "-h") parsed.help = true;
		else if (arg === "--json") parsed.json = true;
		else {
			console.error(chalk.red(`Unknown option for "${APP_NAME} agents": ${arg}`));
			console.error(chalk.dim(`Usage: ${APP_NAME} agents [--json]`));
			process.exitCode = 1;
			return parsed;
		}
	}
	return parsed;
}

function printAgentsHelp(): void {
	console.log(`${APP_NAME} agents

Usage:
  ${APP_NAME} agents [--json]

Options:
  --json    Output discovered agents as JSON
  --help    Show this help
`);
}

export async function runAgentsCommand(args: string[]): Promise<void> {
	const parsed = parseAgentsCommandArgs(args);
	if (process.exitCode === 1) return;
	if (parsed.help) {
		printAgentsHelp();
		return;
	}

	const discovery = discoverAgents(process.cwd());
	if (parsed.json) {
		console.log(
			JSON.stringify(
				{
					agents: discovery.agents,
					userAgentsDir: discovery.userAgentsDir,
					projectAgentsDir: discovery.projectAgentsDir,
					builtinAgentsDir: discovery.builtinAgentsDir,
				},
				null,
				2,
			),
		);
		return;
	}

	if (discovery.agents.length === 0) {
		console.log(chalk.dim("No agents discovered"));
		return;
	}

	console.log(chalk.bold("Available Agents:\n"));
	for (const agent of discovery.agents) {
		const source = chalk.dim(`[${agent.source}]`);
		const model = agent.model ? chalk.dim(` model:${agent.model}`) : "";
		const thinking = agent.thinking ? chalk.dim(` thinking:${agent.thinking}`) : "";
		console.log(`  ${chalk.cyan(agent.name)} ${source}${model}${thinking}`);
		console.log(chalk.dim(`    ${agent.description}`));
	}

	const locations: string[] = [];
	if (discovery.projectAgentsDir) locations.push(`project: ${discovery.projectAgentsDir}`);
	if (discovery.userAgentsDir) locations.push(`user: ${discovery.userAgentsDir}`);
	locations.push(`builtin: ${discovery.builtinAgentsDir}`);
	console.log(`\n${chalk.bold("Discovery Roots:")}`);
	for (const location of locations) {
		console.log(`  ${chalk.dim(location)}`);
	}
}
