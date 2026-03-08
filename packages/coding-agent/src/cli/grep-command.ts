import chalk from "chalk";
import { APP_NAME } from "../config.js";
import { createGrepTool, type GrepToolInput } from "../core/tools/grep.js";

interface GrepCommandArgs extends GrepToolInput {
	json: boolean;
}

function printGrepHelp(): void {
	console.log(`${APP_NAME} grep

Usage:
  ${APP_NAME} grep <pattern> [path] [options]

Options:
  --glob <pattern>       Filter files by glob
  --ignore-case          Case-insensitive search
  --literal              Treat pattern as a literal string
  --context <lines>      Show surrounding context lines
  --limit <count>        Maximum matches to return
  --json                 Output raw result JSON
  --help                 Show this help
`);
}

function parseIntegerOption(name: string, value: string): number | undefined {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0) {
		console.error(chalk.red(`Invalid value for ${name}: ${value}`));
		process.exitCode = 1;
		return undefined;
	}
	return parsed;
}

function parseGrepCommandArgs(args: string[]): GrepCommandArgs | undefined {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printGrepHelp();
		return undefined;
	}

	const parsed: GrepCommandArgs = {
		pattern: args[0],
		json: false,
	};
	const positionals: string[] = [];

	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			printGrepHelp();
			return undefined;
		}
		if (arg === "--json") {
			parsed.json = true;
			continue;
		}
		if (arg === "--ignore-case") {
			parsed.ignoreCase = true;
			continue;
		}
		if (arg === "--literal") {
			parsed.literal = true;
			continue;
		}
		if (arg === "--glob" || arg === "--context" || arg === "--limit") {
			const value = args[i + 1];
			if (value === undefined) {
				console.error(chalk.red(`Missing value for ${arg}`));
				process.exitCode = 1;
				return undefined;
			}
			i += 1;
			if (arg === "--glob") {
				parsed.glob = value;
			} else if (arg === "--context") {
				const context = parseIntegerOption("--context", value);
				if (context === undefined) return undefined;
				parsed.context = context;
			} else {
				const limit = parseIntegerOption("--limit", value);
				if (limit === undefined) return undefined;
				parsed.limit = limit;
			}
			continue;
		}
		if (arg.startsWith("-")) {
			console.error(chalk.red(`Unknown option for "${APP_NAME} grep": ${arg}`));
			process.exitCode = 1;
			return undefined;
		}
		positionals.push(arg);
	}

	if (positionals.length > 1) {
		console.error(chalk.red(`Too many positional arguments for "${APP_NAME} grep"`));
		process.exitCode = 1;
		return undefined;
	}
	if (positionals[0]) {
		parsed.path = positionals[0];
	}
	return parsed;
}

export async function runGrepCommand(args: string[]): Promise<void> {
	const parsed = parseGrepCommandArgs(args);
	if (!parsed || process.exitCode === 1) return;

	const grepTool = createGrepTool(process.cwd());
	try {
		const result = await grepTool.execute("cli-grep", parsed);
		if (parsed.json) {
			console.log(JSON.stringify(result, null, 2));
			return;
		}
		const text = result.content.find((block) => block.type === "text");
		console.log(text?.text ?? "");
	} catch (error) {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
	}
}
