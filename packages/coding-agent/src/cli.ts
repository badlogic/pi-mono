#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
process.title = "pi";

import { existsSync } from "fs";
import { dirname, join } from "path";
import { main } from "./main.js";

/**
 * Recursively find and load .env file from CWD upwards.
 * This ensures project-specific API keys are available to the agent.
 */
function loadEnv() {
	let currentDir = process.cwd();
	while (currentDir !== dirname(currentDir)) {
		const envPath = join(currentDir, ".env");
		if (existsSync(envPath)) {
			try {
				if (typeof process.loadEnvFile === "function") {
					process.loadEnvFile(envPath);
				}
			} catch (_e) {
				// Silently fail if .env is malformed or inaccessible
			}
			break;
		}
		currentDir = dirname(currentDir);
	}
}

loadEnv();
main(process.argv.slice(2));
