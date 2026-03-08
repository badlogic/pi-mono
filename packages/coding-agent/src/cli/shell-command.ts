import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { APP_NAME } from "../config.js";
import { getShellConfig, getShellEnv, killProcessTree, sanitizeBinaryOutput } from "../utils/shell.js";

export interface ShellCommandArgs {
	cwd?: string;
	timeoutMs?: number;
	noSnapshot?: boolean;
}

interface ShellPrompt {
	question(prompt: string): Promise<string>;
	close(): void;
}

interface ShellRunResult {
	exitCode: number | undefined;
	cancelled: boolean;
	timedOut: boolean;
}

interface ShellRunner {
	run(options: {
		command: string;
		cwd: string;
		timeoutMs?: number;
		signal?: AbortSignal;
		onChunk: (chunk: string) => void;
	}): Promise<ShellRunResult>;
}

interface ShellCommandDeps {
	isTTY?: boolean;
	createPrompt?: () => ShellPrompt;
	runner?: ShellRunner;
	stdoutWrite?: (text: string) => void;
	stderrWrite?: (text: string) => void;
	onSigint?: (handler: () => void) => void;
	offSigint?: (handler: () => void) => void;
}

function printShellHelp(write: (text: string) => void = (text) => process.stdout.write(text)): void {
	write(`${chalk.bold(`${APP_NAME} shell`)} - Interactive shell console

${chalk.bold("Usage:")}
  ${APP_NAME} shell [options]

${chalk.bold("Options:")}
  --cwd, -C <path>     Set initial working directory for commands
  --timeout, -t <ms>   Timeout per command in milliseconds
  --no-snapshot        Accepted for compatibility; currently a no-op
  -h, --help           Show this help

${chalk.bold("Special Commands:")}
  .help                Show shell help
  .exit, exit, quit    Exit the shell console
  cd <path>            Change working directory for later commands

${chalk.bold("Examples:")}
  ${APP_NAME} shell
  ${APP_NAME} shell --cwd ./tmp
  ${APP_NAME} shell --timeout 2000
`);
}

function createDefaultPrompt(): ShellPrompt {
	return createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true,
	});
}

function createDefaultRunner(): ShellRunner {
	return {
		run({ command, cwd, timeoutMs, signal, onChunk }) {
			return new Promise((resolvePromise, reject) => {
				const { shell, args } = getShellConfig();
				const child: ChildProcess = spawn(shell, [...args, command], {
					cwd,
					detached: true,
					env: getShellEnv(),
					stdio: ["ignore", "pipe", "pipe"],
				});

				let timedOut = false;
				let killed = false;
				let timeoutHandle: NodeJS.Timeout | undefined;

				const onAbort = () => {
					killed = true;
					if (child.pid) {
						killProcessTree(child.pid);
					}
				};

				if (signal) {
					if (signal.aborted) {
						onAbort();
					} else {
						signal.addEventListener("abort", onAbort, { once: true });
					}
				}

				if (timeoutMs && timeoutMs > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						onAbort();
					}, timeoutMs);
				}

				const handleData = (data: Buffer) => {
					const text = sanitizeBinaryOutput(data.toString("utf8")).replace(/\r/g, "");
					if (text.length > 0) {
						onChunk(text);
					}
				};

				child.stdout?.on("data", handleData);
				child.stderr?.on("data", handleData);

				child.on("error", (error) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					if (signal) signal.removeEventListener("abort", onAbort);
					reject(error);
				});

				child.on("close", (code) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					if (signal) signal.removeEventListener("abort", onAbort);
					resolvePromise({
						exitCode: code ?? undefined,
						cancelled: killed && !timedOut,
						timedOut,
					});
				});
			});
		},
	};
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

function parseShellCommandArgs(args: string[]): ShellCommandArgs | undefined {
	const parsed: ShellCommandArgs = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			printShellHelp();
			return undefined;
		}
		if (arg === "--cwd" || arg === "-C") {
			const value = args[i + 1];
			if (value === undefined) {
				console.error(chalk.red(`Missing value for ${arg}`));
				process.exitCode = 1;
				return undefined;
			}
			i += 1;
			parsed.cwd = value;
			continue;
		}
		if (arg === "--timeout" || arg === "-t") {
			const value = args[i + 1];
			if (value === undefined) {
				console.error(chalk.red(`Missing value for ${arg}`));
				process.exitCode = 1;
				return undefined;
			}
			i += 1;
			const timeoutMs = parseIntegerOption(arg, value);
			if (timeoutMs === undefined) return undefined;
			parsed.timeoutMs = timeoutMs;
			continue;
		}
		if (arg === "--no-snapshot") {
			parsed.noSnapshot = true;
			continue;
		}

		console.error(chalk.red(`Unknown option for "${APP_NAME} shell": ${arg}`));
		process.exitCode = 1;
		return undefined;
	}

	return parsed;
}

function resolveDirectory(input: string | undefined, cwd: string): string {
	if (!input || input.trim().length === 0 || input === "~") {
		return homedir();
	}
	if (input === "-") {
		return cwd;
	}
	if (input.startsWith("~")) {
		return resolve(homedir(), input.slice(1));
	}
	return resolve(cwd, input);
}

function changeDirectory(target: string | undefined, cwd: string): { nextCwd?: string; error?: string } {
	const nextCwd = resolveDirectory(target, cwd);
	if (!existsSync(nextCwd)) {
		return { error: `Directory does not exist: ${nextCwd}` };
	}
	if (!statSync(nextCwd).isDirectory()) {
		return { error: `Not a directory: ${nextCwd}` };
	}
	return { nextCwd };
}

export async function runShellCommand(args: string[], deps: ShellCommandDeps = {}): Promise<void> {
	const parsed = parseShellCommandArgs(args);
	if (!parsed || process.exitCode === 1) return;

	const isTTY = deps.isTTY ?? process.stdin.isTTY ?? false;
	if (!isTTY) {
		(deps.stderrWrite ?? ((text) => process.stderr.write(text)))(
			"Error: shell console requires an interactive TTY.\n",
		);
		process.exitCode = 1;
		return;
	}

	const stdoutWrite = deps.stdoutWrite ?? ((text: string) => process.stdout.write(text));
	const stderrWrite = deps.stderrWrite ?? ((text: string) => process.stderr.write(text));
	const promptFactory = deps.createPrompt ?? createDefaultPrompt;
	const runner = deps.runner ?? createDefaultRunner();
	const onSigint = deps.onSigint ?? ((handler) => process.on("SIGINT", handler));
	const offSigint = deps.offSigint ?? ((handler) => process.off("SIGINT", handler));

	let cwd = parsed.cwd ? resolve(process.cwd(), parsed.cwd) : process.cwd();
	if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
		stderrWrite(`Error: working directory does not exist: ${cwd}\n`);
		process.exitCode = 1;
		return;
	}

	const rl = promptFactory();
	let activeController: AbortController | undefined;
	let shouldExit = false;

	const interruptHandler = () => {
		if (activeController) {
			activeController.abort();
			return;
		}
		shouldExit = true;
		rl.close();
	};

	onSigint(interruptHandler);
	stdoutWrite(chalk.dim("Type .help for commands.\n"));

	try {
		while (!shouldExit) {
			const line = (await rl.question(chalk.cyan(`${APP_NAME} shell:${cwd}> `))).trim();
			if (!line) {
				continue;
			}
			if (line === ".help") {
				printShellHelp(stdoutWrite);
				continue;
			}
			if (line === ".exit" || line === "exit" || line === "quit") {
				break;
			}
			if (line === "cd" || line.startsWith("cd ")) {
				const target = line === "cd" ? undefined : line.slice(3).trim();
				const result = changeDirectory(target, cwd);
				if (result.error) {
					stderrWrite(chalk.red(`${result.error}\n`));
				} else if (result.nextCwd) {
					cwd = result.nextCwd;
				}
				continue;
			}

			activeController = new AbortController();
			let lastChar: string | null = null;
			try {
				const result = await runner.run({
					command: line,
					cwd,
					timeoutMs: parsed.timeoutMs,
					signal: activeController.signal,
					onChunk: (chunk) => {
						if (chunk.length > 0) {
							lastChar = chunk[chunk.length - 1] ?? null;
						}
						stdoutWrite(chunk);
					},
				});

				if (lastChar && lastChar !== "\n") {
					stdoutWrite("\n");
				}

				if (result.timedOut) {
					stderrWrite(chalk.yellow("Command timed out.\n"));
				} else if (result.cancelled) {
					stderrWrite(chalk.yellow("Command cancelled.\n"));
				} else if (result.exitCode !== undefined && result.exitCode !== 0) {
					stderrWrite(chalk.yellow(`Exit code: ${result.exitCode}\n`));
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				stderrWrite(chalk.red(`Error: ${message}\n`));
			} finally {
				activeController = undefined;
			}
		}
	} finally {
		offSigint(interruptHandler);
		rl.close();
	}
}
