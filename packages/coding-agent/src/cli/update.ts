/**
 * `pi update` - Update pi to the latest version
 *
 * TODO: Support alternative install methods (pnpm, bun, brew) when we distribute via those channels.
 * Could detect via executable path heuristics or add an `installMethod` setting.
 */
import chalk from "chalk";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { getPackageJsonPath, VERSION } from "../config.js";
import { getLatestVersion } from "./version-check.js";

const pkg = JSON.parse(readFileSync(getPackageJsonPath(), "utf-8"));
const PACKAGE_NAME: string = pkg.name;

/**
 * Run the update command.
 */
export async function handleUpdate(): Promise<void> {
	console.log(chalk.dim(`Current version: ${VERSION}`));
	console.log(chalk.dim("Checking for updates..."));

	const latestVersion = await getLatestVersion();

	if (!latestVersion) {
		console.error(chalk.red("Failed to check for updates. Please check your network connection."));
		process.exit(1);
	}

	if (latestVersion === VERSION) {
		console.log(chalk.green(`Already on the latest version (${VERSION})`));
		return;
	}

	console.log(`\nUpdating to ${chalk.cyan(latestVersion)}...`);

	const result = spawnSync("npm", ["install", "-g", `${PACKAGE_NAME}@latest`], {
		encoding: "utf-8",
		timeout: 120000, // 2 minute timeout
		shell: true,
		stdio: "inherit", // Show npm output directly
	});

	if (result.error) {
		console.error(chalk.red(`\nUpdate failed: ${result.error.message}`));
		process.exit(1);
	}

	if (result.status !== 0) {
		console.error(chalk.red("\nUpdate failed."));
		process.exit(1);
	}

	console.log(chalk.green(`\n✓ Updated to ${latestVersion}`));
}
