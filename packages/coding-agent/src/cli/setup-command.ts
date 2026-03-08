import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { APP_NAME, getAgentDir } from "../config.js";

export type SetupComponent = "python";

interface SetupFlags {
	check: boolean;
	json: boolean;
}

interface SetupCommandArgs {
	component: SetupComponent;
	flags: SetupFlags;
}

interface ProcessResult {
	status: number | null;
	stdout: string;
	stderr: string;
	error?: Error;
}

interface SetupRunner {
	findExecutable(names: string[]): string | undefined;
	run(command: string, args: string[]): ProcessResult;
}

interface PythonSetupStatus {
	component: "python";
	available: boolean;
	pythonPath?: string;
	uvPath?: string;
	pipPath?: string;
	missingPackages: string[];
	installedPackages: string[];
	usingManagedEnv: boolean;
	managedEnvPath: string;
}

interface PythonInstallResult {
	success: boolean;
	usedManagedEnv: boolean;
}

const SUPPORTED_COMPONENTS: SetupComponent[] = ["python"];
const PYTHON_PACKAGES = ["jupyter_kernel_gateway", "ipykernel"] as const;
const MANAGED_ENV_DIR = join(getAgentDir(), "python");

function printSetupHelp(): void {
	console.log(`${APP_NAME} setup

Usage:
  ${APP_NAME} setup <component> [options]

Supported components:
  python               Install or check Python/Jupyter prerequisites

Options:
  --check, -c          Check only; do not install missing dependencies
  --json               Output structured JSON
  --help, -h           Show this help
`);
}

function createDefaultRunner(): SetupRunner {
	return {
		findExecutable(names) {
			const locator = process.platform === "win32" ? "where" : "which";
			for (const name of names) {
				const result = spawnSync(locator, [name], {
					encoding: "utf8",
					stdio: ["ignore", "pipe", "ignore"],
				});
				if (result.status === 0) {
					const match = result.stdout
						.split(/\r?\n/)
						.map((entry) => entry.trim())
						.find((entry) => entry.length > 0);
					if (match) return match;
				}
			}
			return undefined;
		},
		run(command, args) {
			const result: SpawnSyncReturns<string> = spawnSync(command, args, {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			return {
				status: result.status,
				stdout: result.stdout ?? "",
				stderr: result.stderr ?? "",
				error: result.error,
			};
		},
	};
}

function parseSetupCommandArgs(args: string[]): SetupCommandArgs | undefined {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printSetupHelp();
		return undefined;
	}

	const component = args[0];
	if (!SUPPORTED_COMPONENTS.includes(component as SetupComponent)) {
		console.error(chalk.red(`Unknown setup component: ${component}`));
		console.error(chalk.dim(`Supported components: ${SUPPORTED_COMPONENTS.join(", ")}`));
		process.exitCode = 1;
		return undefined;
	}

	const flags: SetupFlags = {
		check: false,
		json: false,
	};
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--check" || arg === "-c") {
			flags.check = true;
			continue;
		}
		if (arg === "--json") {
			flags.json = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			printSetupHelp();
			return undefined;
		}

		console.error(chalk.red(`Unknown option for "${APP_NAME} setup": ${arg}`));
		process.exitCode = 1;
		return undefined;
	}

	return {
		component: component as SetupComponent,
		flags,
	};
}

function getManagedPythonPath(managedEnvPath: string): string {
	return process.platform === "win32"
		? join(managedEnvPath, "Scripts", "python.exe")
		: join(managedEnvPath, "bin", "python");
}

function checkPythonModule(runner: SetupRunner, pythonPath: string, moduleName: string): boolean {
	const script = `import importlib.util; raise SystemExit(0 if importlib.util.find_spec(${JSON.stringify(moduleName)}) else 1)`;
	const result = runner.run(pythonPath, ["-c", script]);
	return result.status === 0;
}

function checkPythonSetup(runner: SetupRunner): PythonSetupStatus {
	const pythonPath = runner.findExecutable(["python3", "python"]);
	const uvPath = runner.findExecutable(["uv"]);
	const pipPath = runner.findExecutable(["pip3", "pip"]);
	const managedPython = getManagedPythonPath(MANAGED_ENV_DIR);
	const candidatePythons = [pythonPath, existsSync(managedPython) ? managedPython : undefined].filter(
		(candidate): candidate is string => !!candidate,
	);

	const status: PythonSetupStatus = {
		component: "python",
		available: false,
		pythonPath,
		uvPath,
		pipPath,
		missingPackages: [...PYTHON_PACKAGES],
		installedPackages: [],
		usingManagedEnv: false,
		managedEnvPath: MANAGED_ENV_DIR,
	};

	if (candidatePythons.length === 0) {
		return status;
	}

	let bestMatch: {
		pythonPath: string;
		missingPackages: string[];
		installedPackages: string[];
		usingManagedEnv: boolean;
	} = {
		pythonPath: candidatePythons[0],
		missingPackages: [...PYTHON_PACKAGES],
		installedPackages: [] as string[],
		usingManagedEnv: candidatePythons[0] === managedPython,
	};

	for (const candidate of candidatePythons) {
		const installedPackages: string[] = [];
		const missingPackages: string[] = [];
		for (const pkg of PYTHON_PACKAGES) {
			const moduleName = pkg === "jupyter_kernel_gateway" ? "kernel_gateway" : pkg;
			if (checkPythonModule(runner, candidate, moduleName)) {
				installedPackages.push(pkg);
			} else {
				missingPackages.push(pkg);
			}
		}

		if (missingPackages.length < bestMatch.missingPackages.length) {
			bestMatch = {
				pythonPath: candidate,
				missingPackages,
				installedPackages,
				usingManagedEnv: candidate === managedPython,
			};
		}
		if (missingPackages.length === 0) {
			return {
				...status,
				available: true,
				pythonPath: candidate,
				missingPackages,
				installedPackages,
				usingManagedEnv: candidate === managedPython,
			};
		}
	}

	return {
		...status,
		pythonPath: bestMatch.pythonPath,
		missingPackages: bestMatch.missingPackages,
		installedPackages: bestMatch.installedPackages,
		usingManagedEnv: bestMatch.usingManagedEnv,
	};
}

function installWithUv(
	runner: SetupRunner,
	packages: readonly string[],
	pythonPath: string,
	uvPath: string,
): PythonInstallResult | undefined {
	const directInstall = runner.run(uvPath, ["pip", "install", "--python", pythonPath, ...packages]);
	if (directInstall.status === 0) {
		return { success: true, usedManagedEnv: false };
	}

	const venvCreate = runner.run(uvPath, ["venv", MANAGED_ENV_DIR]);
	if (venvCreate.status !== 0) {
		return { success: false, usedManagedEnv: true };
	}

	const managedInstall = runner.run(uvPath, ["pip", "install", "--python", MANAGED_ENV_DIR, ...packages]);
	return {
		success: managedInstall.status === 0,
		usedManagedEnv: true,
	};
}

function installWithPip(runner: SetupRunner, packages: readonly string[], pythonPath: string): PythonInstallResult {
	const directInstall = runner.run(pythonPath, ["-m", "pip", "install", ...packages]);
	if (directInstall.status === 0) {
		return { success: true, usedManagedEnv: false };
	}

	const venvCreate = runner.run(pythonPath, ["-m", "venv", MANAGED_ENV_DIR]);
	if (venvCreate.status !== 0) {
		return { success: false, usedManagedEnv: true };
	}

	const managedPython = getManagedPythonPath(MANAGED_ENV_DIR);
	const managedInstall = runner.run(managedPython, ["-m", "pip", "install", ...packages]);
	return {
		success: managedInstall.status === 0,
		usedManagedEnv: true,
	};
}

function installPythonPackages(
	runner: SetupRunner,
	packages: readonly string[],
	pythonPath: string,
	uvPath?: string,
): PythonInstallResult {
	if (uvPath) {
		const uvResult = installWithUv(runner, packages, pythonPath, uvPath);
		if (uvResult?.success) return uvResult;
	}
	return installWithPip(runner, packages, pythonPath);
}

function printPythonStatus(status: PythonSetupStatus): void {
	console.log(chalk.bold("Python/Jupyter setup"));
	if (!status.pythonPath) {
		console.log(chalk.red("No Python interpreter found in PATH."));
		console.log(chalk.dim("Install python3 or python, then rerun `pi setup python`."));
		return;
	}

	console.log(`Python: ${chalk.cyan(status.pythonPath)}`);
	if (status.uvPath) {
		console.log(`uv:     ${chalk.cyan(status.uvPath)}`);
	} else if (status.pipPath) {
		console.log(`pip:    ${chalk.cyan(status.pipPath)}`);
	} else {
		console.log(chalk.yellow("No uv/pip installer detected; falling back to python -m pip if available."));
	}

	if (status.available) {
		console.log(chalk.green("Status: ready"));
		console.log(chalk.dim(`Installed: ${status.installedPackages.join(", ")}`));
		if (status.usingManagedEnv) {
			console.log(chalk.dim(`Using managed env: ${status.managedEnvPath}`));
		}
		return;
	}

	console.log(chalk.yellow("Status: missing dependencies"));
	console.log(chalk.dim(`Missing: ${status.missingPackages.join(", ")}`));
	console.log(chalk.dim("Run without --check to install the missing packages."));
}

function printPythonJson(status: PythonSetupStatus): void {
	console.log(JSON.stringify(status, null, 2));
}

function handlePythonSetup(flags: SetupFlags, runner: SetupRunner): void {
	const status = checkPythonSetup(runner);
	if (flags.check || !status.pythonPath || status.available) {
		if (flags.json) {
			printPythonJson(status);
		} else {
			printPythonStatus(status);
		}
		if (!status.available) {
			process.exitCode = 1;
		}
		return;
	}

	const installResult = installPythonPackages(runner, status.missingPackages, status.pythonPath, status.uvPath);
	const refreshedStatus = checkPythonSetup(runner);
	const finalStatus: PythonSetupStatus = {
		...refreshedStatus,
		usingManagedEnv: refreshedStatus.usingManagedEnv || installResult.usedManagedEnv,
	};

	if (flags.json) {
		printPythonJson(finalStatus);
	} else if (installResult.success) {
		console.log(chalk.green(`Installed missing Python dependencies for ${APP_NAME}.`));
		printPythonStatus(finalStatus);
	} else {
		console.error(chalk.red("Failed to install Python dependencies."));
		printPythonStatus(finalStatus);
	}

	if (!installResult.success || !finalStatus.available) {
		process.exitCode = 1;
	}
}

export async function runSetupCommand(args: string[], runner: SetupRunner = createDefaultRunner()): Promise<void> {
	const parsed = parseSetupCommandArgs(args);
	if (!parsed || process.exitCode === 1) return;

	switch (parsed.component) {
		case "python":
			handlePythonSetup(parsed.flags, runner);
			break;
	}
}
