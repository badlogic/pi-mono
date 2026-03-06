import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CONFIG_DIR_NAME = ".pi";
const DEFAULT_AGENT_DIR = join(homedir(), DEFAULT_CONFIG_DIR_NAME, "agent");
const DEFAULT_CONFIG_ROOT = join(homedir(), DEFAULT_CONFIG_DIR_NAME);

function expandHome(pathValue: string): string {
	if (pathValue === "~") return homedir();
	if (pathValue.startsWith("~/")) return join(homedir(), pathValue.slice(2));
	return pathValue;
}

export function getConfigRootDir(): string {
	const envValue = process.env.PI_STATS_CONFIG_DIR;
	return envValue ? expandHome(envValue) : DEFAULT_CONFIG_ROOT;
}

export function getAgentDir(): string {
	const envValue = process.env.PI_CODING_AGENT_DIR;
	return envValue ? expandHome(envValue) : DEFAULT_AGENT_DIR;
}

export function getSessionsDir(): string {
	const envValue = process.env.PI_STATS_SESSIONS_DIR;
	return envValue ? expandHome(envValue) : join(getAgentDir(), "sessions");
}

export function getStatsDbPath(): string {
	const envValue = process.env.PI_STATS_DB_PATH;
	return envValue ? expandHome(envValue) : join(getConfigRootDir(), "stats.db");
}

export function getPackageDir(): string {
	let dir = __dirname;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	return resolve(__dirname, "..");
}

export function getClientEntryPath(): string {
	return join(getPackageDir(), "src", "client", "index.ts");
}

export function getClientHtmlPath(): string {
	return join(getPackageDir(), "src", "client", "index.html");
}

export function getClientCssPath(): string {
	return join(getPackageDir(), "src", "client", "styles.css");
}

export function getBuiltClientDir(): string {
	return join(getPackageDir(), "dist", "client");
}
