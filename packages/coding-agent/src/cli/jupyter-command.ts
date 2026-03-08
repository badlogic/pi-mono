import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { APP_NAME, getAgentDir } from "../config.js";

export type JupyterAction = "kill" | "status";

interface JupyterCommandArgs {
	action: JupyterAction;
	json: boolean;
}

interface JupyterGatewayState {
	pid: number;
	url: string;
	startedAt: string;
	pythonPath?: string;
	venvPath?: string;
}

interface JupyterGatewayStatus {
	active: boolean;
	pid: number | null;
	url: string | null;
	uptime: number | null;
	pythonPath: string | null;
	venvPath: string | null;
	statePath: string;
}

interface JupyterCommandDeps {
	readStatus?: () => JupyterGatewayStatus;
	shutdown?: (status: JupyterGatewayStatus) => Promise<boolean>;
	log?: (text: string) => void;
	error?: (text: string) => void;
}

const GATEWAY_STATE_PATH = join(getAgentDir(), "jupyter-gateway.json");

function printJupyterHelp(): void {
	console.log(`${chalk.bold(`${APP_NAME} jupyter`)} - Manage the shared Jupyter gateway

${chalk.bold("Usage:")}
  ${APP_NAME} jupyter [status|kill] [--json]

${chalk.bold("Commands:")}
  status    Show gateway status (default)
  kill      Stop the recorded gateway process

${chalk.bold("Examples:")}
  ${APP_NAME} jupyter
  ${APP_NAME} jupyter status
  ${APP_NAME} jupyter kill
`);
}

function parseJupyterArgs(args: string[]): JupyterCommandArgs | undefined {
	if (args.length === 0) {
		return { action: "status", json: false };
	}
	if (args[0] === "--help" || args[0] === "-h") {
		printJupyterHelp();
		return undefined;
	}

	let action: JupyterAction = "status";
	let startIndex = 0;
	if (args[0] === "status" || args[0] === "kill") {
		action = args[0];
		startIndex = 1;
	}

	let json = false;
	for (let i = startIndex; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			printJupyterHelp();
			return undefined;
		}
		console.error(chalk.red(`Unknown option for "${APP_NAME} jupyter": ${arg}`));
		process.exitCode = 1;
		return undefined;
	}

	return { action, json };
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readGatewayStatus(): JupyterGatewayStatus {
	if (!existsSync(GATEWAY_STATE_PATH)) {
		return {
			active: false,
			pid: null,
			url: null,
			uptime: null,
			pythonPath: null,
			venvPath: null,
			statePath: GATEWAY_STATE_PATH,
		};
	}

	try {
		const raw = readFileSync(GATEWAY_STATE_PATH, "utf8");
		const parsed = JSON.parse(raw) as Partial<JupyterGatewayState>;
		if (!parsed.pid || !parsed.url || !parsed.startedAt) {
			return {
				active: false,
				pid: null,
				url: null,
				uptime: null,
				pythonPath: null,
				venvPath: null,
				statePath: GATEWAY_STATE_PATH,
			};
		}

		const active = isPidAlive(parsed.pid);
		const startedAtMs = Date.parse(parsed.startedAt);
		const uptime = Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : null;
		return {
			active,
			pid: active ? parsed.pid : null,
			url: active ? parsed.url : null,
			uptime: active ? uptime : null,
			pythonPath: active ? (parsed.pythonPath ?? null) : null,
			venvPath: active ? (parsed.venvPath ?? null) : null,
			statePath: GATEWAY_STATE_PATH,
		};
	} catch {
		return {
			active: false,
			pid: null,
			url: null,
			uptime: null,
			pythonPath: null,
			venvPath: null,
			statePath: GATEWAY_STATE_PATH,
		};
	}
}

async function shutdownGateway(status: JupyterGatewayStatus): Promise<boolean> {
	if (!status.active || !status.pid) {
		if (existsSync(status.statePath)) {
			rmSync(status.statePath, { force: true });
		}
		return false;
	}

	try {
		process.kill(status.pid, "SIGTERM");
	} catch {
		// If the process is already gone, still clean up the state file.
	}

	if (existsSync(status.statePath)) {
		rmSync(status.statePath, { force: true });
	}
	return true;
}

function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}

function renderStatus(status: JupyterGatewayStatus, log: (text: string) => void): void {
	if (!status.active) {
		log(chalk.dim("No Jupyter gateway is running"));
		return;
	}

	log(chalk.bold("Jupyter Gateway Status\n"));
	log(`  ${chalk.green("●")} Running`);
	log(`  PID:    ${status.pid}`);
	log(`  URL:    ${status.url}`);
	if (status.uptime !== null) {
		log(`  Uptime: ${formatUptime(status.uptime)}`);
	}
	if (status.pythonPath) {
		log(`  Python: ${status.pythonPath}`);
	}
	if (status.venvPath) {
		log(`  Venv:   ${status.venvPath}`);
	}
}

export async function runJupyterCommand(args: string[], deps: JupyterCommandDeps = {}): Promise<void> {
	const parsed = parseJupyterArgs(args);
	if (!parsed || process.exitCode === 1) return;

	const readStatus = deps.readStatus ?? readGatewayStatus;
	const shutdown = deps.shutdown ?? shutdownGateway;
	const log = deps.log ?? console.log;
	const error = deps.error ?? console.error;

	switch (parsed.action) {
		case "status": {
			const status = readStatus();
			if (parsed.json) {
				log(JSON.stringify(status, null, 2));
				return;
			}
			renderStatus(status, log);
			return;
		}
		case "kill": {
			const status = readStatus();
			if (!status.active) {
				if (parsed.json) {
					log(JSON.stringify({ stopped: false, reason: "not-running", ...status }, null, 2));
				} else {
					log(chalk.dim("No Jupyter gateway is running"));
				}
				return;
			}

			const stopped = await shutdown(status);
			if (parsed.json) {
				log(JSON.stringify({ stopped, pid: status.pid, url: status.url }, null, 2));
				return;
			}
			if (stopped) {
				log(`Killing Jupyter gateway (PID ${status.pid})...`);
				log(chalk.green("Jupyter gateway stopped"));
				return;
			}
			error(chalk.red("Failed to stop Jupyter gateway"));
			process.exitCode = 1;
		}
	}
}
