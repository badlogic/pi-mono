#!/usr/bin/env node

/**
 * CLI entry point for the Embry Agent D-Bus bridge.
 *
 * Usage: pi-dbus [--cwd DIR] [--provider PROVIDER] [--model MODEL]
 *
 * Registers org.embry.Agent on the session bus and keeps running
 * until SIGTERM/SIGINT.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentDBusBridge } from "./bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs(): { cwd?: string; provider?: string; model?: string; sessionFile?: string } {
	const args = process.argv.slice(2);
	const result: Record<string, string> = {};

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--cwd":
				result.cwd = args[++i];
				break;
			case "--provider":
				result.provider = args[++i];
				break;
			case "--model":
				result.model = args[++i];
				break;
			case "--session":
				result.sessionFile = args[++i];
				break;
			case "--help":
			case "-h":
				console.log("Usage: pi-dbus [--cwd DIR] [--provider PROVIDER] [--model MODEL] [--session FILE]");
				console.log("");
				console.log("Registers org.embry.Agent on the D-Bus session bus.");
				console.log("Pi runs as a child process in RPC mode.");
				console.log("");
				console.log("Options:");
				console.log("  --session FILE   Resume from a specific session file");
				process.exit(0);
		}
	}

	return result;
}

async function main(): Promise<void> {
	const opts = parseArgs();

	// Pi CLI is at dist/cli.js, two dirs up from dist/dbus/cli.js
	const piCliPath = resolve(__dirname, "..", "cli.js");

	const bridge = new AgentDBusBridge({
		cwd: opts.cwd ?? process.cwd(),
		provider: opts.provider,
		model: opts.model,
		cliPath: piCliPath,
		sessionFile: opts.sessionFile,
	});

	// Graceful shutdown
	const shutdown = async () => {
		console.log("\n[embry-agent] Shutting down...");
		await bridge.stop();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	try {
		await bridge.start();
		console.log("[embry-agent] Ready. Listening on D-Bus session bus.");
	} catch (err) {
		console.error(`[embry-agent] Failed to start: ${err}`);
		process.exit(1);
	}
}

main();
