import chalk from "chalk";
import { APP_NAME, getAgentDir } from "../config.js";
import { DefaultPackageManager, type PackageManager } from "../core/package-manager.js";
import { SettingsManager } from "../core/settings-manager.js";

type PluginAction = "install" | "uninstall" | "list" | "link" | "doctor" | "features" | "config" | "enable" | "disable";

interface PluginFlags {
	json?: boolean;
	fix?: boolean;
	force?: boolean;
	dryRun?: boolean;
	local?: boolean;
}

interface PluginCommandArgs {
	action: PluginAction;
	targets: string[];
	flags: PluginFlags;
}

interface PluginDoctorEntry {
	source: string;
	scope: "user" | "project";
	type: "npm" | "git" | "local";
	status: "ok" | "error";
	message: string;
	path?: string;
	fixed?: boolean;
}

interface PluginListEntry {
	source: string;
	scope: "user" | "project";
	type: "npm" | "git" | "local";
	filtered: boolean;
	path?: string;
	installed: boolean;
}

interface PluginCommandDependencies {
	cwd?: string;
	agentDir?: string;
	createSettingsManager?: (cwd: string, agentDir: string) => SettingsManager;
	createPackageManager?: (args: { cwd: string; agentDir: string; settingsManager: SettingsManager }) => PackageManager;
}

const VALID_ACTIONS: readonly PluginAction[] = [
	"install",
	"uninstall",
	"list",
	"link",
	"doctor",
	"features",
	"config",
	"enable",
	"disable",
];

function printPluginHelp(): void {
	console.log(`${APP_NAME} plugin

Usage:
  ${APP_NAME} plugin list [--json] [--local]
  ${APP_NAME} plugin install <source>... [--local] [--json] [--dry-run]
  ${APP_NAME} plugin uninstall <source>... [--local] [--json] [--dry-run]
  ${APP_NAME} plugin link <path>... [--local] [--json] [--dry-run]
  ${APP_NAME} plugin doctor [--json] [--fix]

Options:
  --json       Output JSON
  --fix        Attempt to repair missing non-local plugins during doctor
  --force      Accepted for compatibility (currently no special behavior)
  --dry-run    Preview install/uninstall/link actions without applying them
  --local      Use project-local settings instead of user settings
  --help       Show this help

Notes:
  This is a compatibility wrapper over pi's package manager.
  Unsupported oh-my-pi plugin actions: features, config, enable, disable
`);
}

function classifyPluginSource(source: string): "npm" | "git" | "local" {
	if (source.startsWith("npm:")) {
		return "npm";
	}
	if (
		source.startsWith("git:") ||
		source.startsWith("http://") ||
		source.startsWith("https://") ||
		source.startsWith("ssh://") ||
		source.startsWith("git@")
	) {
		return "git";
	}
	return "local";
}

function parsePluginCommandArgs(args: string[]): PluginCommandArgs | undefined {
	const [maybeAction, ...rest] = args;
	if (!maybeAction || maybeAction === "--help" || maybeAction === "-h") {
		printPluginHelp();
		return undefined;
	}
	if (!VALID_ACTIONS.includes(maybeAction as PluginAction)) {
		console.error(chalk.red(`Unknown plugin action: ${maybeAction}`));
		console.error(chalk.dim(`Usage: ${APP_NAME} plugin <${VALID_ACTIONS.join("|")}> [...]`));
		process.exitCode = 1;
		return undefined;
	}

	const parsed: PluginCommandArgs = {
		action: maybeAction as PluginAction,
		targets: [],
		flags: {},
	};

	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--help" || arg === "-h") {
			printPluginHelp();
			return undefined;
		}
		if (arg === "--json") {
			parsed.flags.json = true;
			continue;
		}
		if (arg === "--fix") {
			parsed.flags.fix = true;
			continue;
		}
		if (arg === "--force") {
			parsed.flags.force = true;
			continue;
		}
		if (arg === "--dry-run") {
			parsed.flags.dryRun = true;
			continue;
		}
		if (arg === "--local" || arg === "-l") {
			parsed.flags.local = true;
			continue;
		}
		if (arg.startsWith("-")) {
			console.error(chalk.red(`Unknown option for "${APP_NAME} plugin": ${arg}`));
			process.exitCode = 1;
			return undefined;
		}
		parsed.targets.push(arg);
	}

	return parsed;
}

function createRuntime(deps: PluginCommandDependencies | undefined): {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
	packageManager: PackageManager;
} {
	const cwd = deps?.cwd ?? process.cwd();
	const agentDir = deps?.agentDir ?? getAgentDir();
	const settingsManager = deps?.createSettingsManager
		? deps.createSettingsManager(cwd, agentDir)
		: SettingsManager.create(cwd, agentDir);
	const packageManager = deps?.createPackageManager
		? deps.createPackageManager({ cwd, agentDir, settingsManager })
		: new DefaultPackageManager({ cwd, agentDir, settingsManager });
	return { cwd, agentDir, settingsManager, packageManager };
}

function getListEntries(settingsManager: SettingsManager, packageManager: PackageManager): PluginListEntry[] {
	const projectPackages = settingsManager.getProjectSettings().packages ?? [];
	const userPackages = settingsManager.getGlobalSettings().packages ?? [];

	const entries: PluginListEntry[] = [];
	for (const [scope, packages] of [
		["project", projectPackages],
		["user", userPackages],
	] as const) {
		for (const pkg of packages) {
			const source = typeof pkg === "string" ? pkg : pkg.source;
			const path = packageManager.getInstalledPath(source, scope);
			entries.push({
				source,
				scope,
				type: classifyPluginSource(source),
				filtered: typeof pkg === "object",
				path,
				installed: Boolean(path),
			});
		}
	}
	return entries;
}

async function handleList(
	settingsManager: SettingsManager,
	packageManager: PackageManager,
	json = false,
): Promise<void> {
	const entries = getListEntries(settingsManager, packageManager);
	if (json) {
		console.log(JSON.stringify({ plugins: entries }, null, 2));
		return;
	}
	if (entries.length === 0) {
		console.log(chalk.dim("No plugins installed"));
		console.log(chalk.dim(`Install one with: ${APP_NAME} plugin install <source>`));
		return;
	}

	const printGroup = (scope: "user" | "project") => {
		const scopedEntries = entries.filter((entry) => entry.scope === scope);
		if (scopedEntries.length === 0) {
			return;
		}
		console.log(chalk.bold(scope === "project" ? "Project plugins:" : "User plugins:"));
		for (const entry of scopedEntries) {
			const filtered = entry.filtered ? chalk.dim(" (filtered)") : "";
			const missing = entry.installed ? "" : chalk.red(" [missing]");
			console.log(`  ${entry.source}${filtered}${missing}`);
			if (entry.path) {
				console.log(chalk.dim(`    ${entry.path}`));
			}
		}
	};

	printGroup("project");
	if (entries.some((entry) => entry.scope === "project") && entries.some((entry) => entry.scope === "user")) {
		console.log("");
	}
	printGroup("user");
}

async function handleInstallLike(
	action: "install" | "link",
	cmd: PluginCommandArgs,
	settingsManager: SettingsManager,
	packageManager: PackageManager,
): Promise<void> {
	if (cmd.targets.length === 0) {
		console.error(chalk.red(`Missing source for plugin ${action}.`));
		process.exitCode = 1;
		return;
	}

	for (const source of cmd.targets) {
		if (cmd.flags.dryRun) {
			const scopeLabel = cmd.flags.local ? "project" : "user";
			console.log(
				cmd.flags.json
					? JSON.stringify({ action, source, scope: scopeLabel, dryRun: true }, null, 2)
					: chalk.dim(`[dry-run] Would ${action} ${source} in ${scopeLabel} scope`),
			);
			continue;
		}

		await packageManager.install(source, { local: cmd.flags.local });
		packageManager.addSourceToSettings(source, { local: cmd.flags.local });
		await settingsManager.flush();
		if (cmd.flags.json) {
			console.log(
				JSON.stringify(
					{
						action,
						source,
						scope: cmd.flags.local ? "project" : "user",
					},
					null,
					2,
				),
			);
		} else {
			console.log(chalk.green(`${action === "link" ? "Linked" : "Installed"} ${source}`));
		}
	}
}

async function handleUninstall(
	cmd: PluginCommandArgs,
	settingsManager: SettingsManager,
	packageManager: PackageManager,
): Promise<void> {
	if (cmd.targets.length === 0) {
		console.error(chalk.red("Missing source for plugin uninstall."));
		process.exitCode = 1;
		return;
	}

	for (const source of cmd.targets) {
		if (cmd.flags.dryRun) {
			const scopeLabel = cmd.flags.local ? "project" : "user";
			console.log(
				cmd.flags.json
					? JSON.stringify({ action: "uninstall", source, scope: scopeLabel, dryRun: true }, null, 2)
					: chalk.dim(`[dry-run] Would uninstall ${source} from ${scopeLabel} scope`),
			);
			continue;
		}

		await packageManager.remove(source, { local: cmd.flags.local });
		const removed = packageManager.removeSourceFromSettings(source, { local: cmd.flags.local });
		await settingsManager.flush();
		if (!removed) {
			console.error(chalk.red(`No configured plugin matches ${source}`));
			process.exitCode = 1;
			return;
		}
		if (cmd.flags.json) {
			console.log(
				JSON.stringify(
					{
						action: "uninstall",
						source,
						scope: cmd.flags.local ? "project" : "user",
					},
					null,
					2,
				),
			);
		} else {
			console.log(chalk.green(`Uninstalled ${source}`));
		}
	}
}

async function handleDoctor(
	cmd: PluginCommandArgs,
	settingsManager: SettingsManager,
	packageManager: PackageManager,
): Promise<void> {
	const entries = getListEntries(settingsManager, packageManager);
	const results: PluginDoctorEntry[] = [];

	for (const entry of entries) {
		if (entry.installed) {
			results.push({
				source: entry.source,
				scope: entry.scope,
				type: entry.type,
				status: "ok",
				message: "Installed",
				path: entry.path,
			});
			continue;
		}

		if (entry.type !== "local" && cmd.flags.fix) {
			try {
				await packageManager.install(entry.source, { local: entry.scope === "project" });
				const repairedPath = packageManager.getInstalledPath(entry.source, entry.scope);
				results.push({
					source: entry.source,
					scope: entry.scope,
					type: entry.type,
					status: "ok",
					message: repairedPath ? "Reinstalled" : "Repair attempted",
					path: repairedPath,
					fixed: true,
				});
				continue;
			} catch (error) {
				results.push({
					source: entry.source,
					scope: entry.scope,
					type: entry.type,
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				});
				continue;
			}
		}

		results.push({
			source: entry.source,
			scope: entry.scope,
			type: entry.type,
			status: "error",
			message:
				entry.type === "local" ? "Local plugin path does not exist" : "Plugin is configured but not installed",
		});
	}

	if (cmd.flags.json) {
		console.log(
			JSON.stringify(
				{
					ok: results.filter((entry) => entry.status === "ok"),
					errors: results.filter((entry) => entry.status === "error"),
				},
				null,
				2,
			),
		);
	} else if (results.length === 0) {
		console.log(chalk.dim("No plugins configured"));
	} else {
		for (const entry of results) {
			const prefix = entry.status === "ok" ? chalk.green("ok") : chalk.red("error");
			const fixed = entry.fixed ? chalk.dim(" (fixed)") : "";
			console.log(`${prefix} ${entry.source}${fixed}`);
			console.log(chalk.dim(`  ${entry.scope} ${entry.type}: ${entry.message}`));
			if (entry.path) {
				console.log(chalk.dim(`  ${entry.path}`));
			}
		}
	}

	if (results.some((entry) => entry.status === "error")) {
		process.exitCode = 1;
	}
}

function reportUnsupportedAction(action: PluginAction): void {
	console.error(
		chalk.red(
			`"${APP_NAME} plugin ${action}" is not supported in pi-mono yet. The current compatibility layer supports install, uninstall, link, list, and doctor.`,
		),
	);
	process.exitCode = 1;
}

export async function runPluginCommand(args: string[], deps?: PluginCommandDependencies): Promise<void> {
	const parsed = parsePluginCommandArgs(args);
	if (!parsed) {
		return;
	}
	if (process.exitCode === 1) {
		return;
	}

	const { settingsManager, packageManager } = createRuntime(deps);

	try {
		switch (parsed.action) {
			case "install":
				await handleInstallLike("install", parsed, settingsManager, packageManager);
				return;
			case "link":
				await handleInstallLike("link", parsed, settingsManager, packageManager);
				return;
			case "uninstall":
				await handleUninstall(parsed, settingsManager, packageManager);
				return;
			case "list":
				await handleList(settingsManager, packageManager, parsed.flags.json);
				return;
			case "doctor":
				await handleDoctor(parsed, settingsManager, packageManager);
				return;
			case "features":
			case "config":
			case "enable":
			case "disable":
				reportUnsupportedAction(parsed.action);
				return;
		}
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = 1;
	}
}
