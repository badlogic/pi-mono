import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";

export interface SSHHostConfig {
	host: string;
	username?: string;
	port?: number;
	keyPath?: string;
	description?: string;
	compat?: boolean;
}

export interface SSHConfigFile {
	hosts?: Record<string, SSHHostConfig>;
}

export type SSHScope = "project" | "user";

export function getSSHConfigPath(scope: SSHScope, cwd: string = process.cwd()): string {
	return scope === "project" ? resolve(cwd, CONFIG_DIR_NAME, "ssh.json") : join(getAgentDir(), "ssh.json");
}

export async function readSSHConfigFile(filePath: string): Promise<SSHConfigFile> {
	try {
		const content = await readFile(filePath, "utf-8");
		return JSON.parse(content) as SSHConfigFile;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { hosts: {} };
		}
		if (error instanceof SyntaxError) {
			throw new Error(`Failed to parse SSH config file ${filePath}: ${error.message}`);
		}
		throw error;
	}
}

export async function writeSSHConfigFile(filePath: string, config: SSHConfigFile): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
	const tmpPath = `${filePath}.tmp`;
	await writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
	await rename(tmpPath, filePath);
}

export function validateHostName(name: string): string | undefined {
	if (!name) return "Host name cannot be empty";
	if (name.length > 100) return "Host name is too long (max 100 characters)";
	if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
		return "Host name can only contain letters, numbers, dash, underscore, and dot";
	}
	return undefined;
}

export async function addSSHHost(filePath: string, name: string, hostConfig: SSHHostConfig): Promise<void> {
	const nameError = validateHostName(name);
	if (nameError) throw new Error(nameError);
	if (!hostConfig.host) throw new Error("Host address cannot be empty");

	const existing = await readSSHConfigFile(filePath);
	if (existing.hosts?.[name]) {
		throw new Error(`Host "${name}" already exists in ${filePath}`);
	}

	await writeSSHConfigFile(filePath, {
		...existing,
		hosts: {
			...existing.hosts,
			[name]: hostConfig,
		},
	});
}

export async function removeSSHHost(filePath: string, name: string): Promise<void> {
	const existing = await readSSHConfigFile(filePath);
	if (!existing.hosts?.[name]) {
		throw new Error(`Host "${name}" not found in ${filePath}`);
	}

	const { [name]: _removed, ...remaining } = existing.hosts;
	await writeSSHConfigFile(filePath, {
		...existing,
		hosts: remaining,
	});
}
