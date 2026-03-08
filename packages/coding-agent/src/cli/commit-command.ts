import { spawnSync } from "node:child_process";
import chalk from "chalk";
import { APP_NAME } from "../config.js";

interface CommitCommandArgs {
	message?: string;
	push: boolean;
	dryRun: boolean;
	noChangelog: boolean;
}

interface CommitRunner {
	run(command: string, args: string[]): { status: number; stdout: string; stderr: string };
}

interface CommitCommandDependencies {
	runner?: CommitRunner;
}

function printCommitHelp(): void {
	console.log(`${APP_NAME} commit

Usage:
  ${APP_NAME} commit [options]

Options:
  -m, --message <text>  Commit message (optional; auto-generated from staged files when omitted)
  --push                Push after committing
  --dry-run             Preview commit message and staged files without committing
  --no-changelog        Accepted for compatibility (currently no automatic changelog editing)
  --help                Show this help

Notes:
  This command only commits already staged changes. It does not auto-stage files.
`);
}

function parseCommitCommandArgs(args: string[]): CommitCommandArgs | undefined {
	if (args[0] === "--help" || args[0] === "-h") {
		printCommitHelp();
		return undefined;
	}

	const parsed: CommitCommandArgs = {
		push: false,
		dryRun: false,
		noChangelog: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			printCommitHelp();
			return undefined;
		}
		if (arg === "--push") {
			parsed.push = true;
			continue;
		}
		if (arg === "--dry-run") {
			parsed.dryRun = true;
			continue;
		}
		if (arg === "--no-changelog") {
			parsed.noChangelog = true;
			continue;
		}
		if (arg === "--message" || arg === "-m") {
			const value = args[++i];
			if (!value) {
				console.error(chalk.red("Missing value for --message"));
				process.exitCode = 1;
				return undefined;
			}
			parsed.message = value;
			continue;
		}
		if (arg.startsWith("-")) {
			console.error(chalk.red(`Unknown option for "${APP_NAME} commit": ${arg}`));
			process.exitCode = 1;
			return undefined;
		}
	}

	return parsed;
}

function createRunner(deps: CommitCommandDependencies | undefined): CommitRunner {
	return (
		deps?.runner ?? {
			run(command: string, args: string[]) {
				const result = spawnSync(command, args, {
					cwd: process.cwd(),
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "pipe"],
					shell: process.platform === "win32",
				});
				return {
					status: result.status ?? 1,
					stdout: result.stdout ?? "",
					stderr: result.stderr ?? "",
				};
			},
		}
	);
}

function getStagedFiles(runner: CommitRunner): string[] {
	const result = runner.run("git", ["diff", "--cached", "--name-only"]);
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || "Failed to inspect staged files");
	}
	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function inferCommitScope(files: string[]): string | undefined {
	const packageNames = new Set<string>();
	for (const file of files) {
		const match = file.match(/^packages\/([^/]+)\//);
		if (match?.[1]) {
			packageNames.add(match[1]);
		}
	}
	if (packageNames.size === 1) {
		return Array.from(packageNames)[0];
	}
	return undefined;
}

function generateCommitMessage(files: string[]): string {
	const scope = inferCommitScope(files);
	if (scope) {
		return `chore(${scope}): update staged files`;
	}
	return "chore: update staged files";
}

export async function runCommitCommand(args: string[], deps?: CommitCommandDependencies): Promise<void> {
	const parsed = parseCommitCommandArgs(args);
	if (!parsed) {
		return;
	}
	if (process.exitCode === 1) {
		return;
	}

	const runner = createRunner(deps);
	try {
		const stagedFiles = getStagedFiles(runner);
		if (stagedFiles.length === 0) {
			console.error(chalk.red("No staged changes to commit"));
			process.exitCode = 1;
			return;
		}

		const message = parsed.message ?? generateCommitMessage(stagedFiles);
		if (parsed.dryRun) {
			console.log(chalk.bold("Commit preview:"));
			console.log(`  message: ${message}`);
			console.log(`  staged files: ${stagedFiles.length}`);
			for (const file of stagedFiles) {
				console.log(chalk.dim(`    ${file}`));
			}
			return;
		}

		const commitResult = runner.run("git", ["commit", "-m", message]);
		if (commitResult.status !== 0) {
			throw new Error(commitResult.stderr.trim() || "git commit failed");
		}
		console.log(chalk.green(`Committed staged changes with message: ${message}`));

		if (parsed.push) {
			const pushResult = runner.run("git", ["push"]);
			if (pushResult.status !== 0) {
				throw new Error(pushResult.stderr.trim() || "git push failed");
			}
			console.log(chalk.green("Pushed current branch"));
		}
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = 1;
	}
}
