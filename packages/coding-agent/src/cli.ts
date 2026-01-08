#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { handleUpdate } from "./cli/update.js";
import { main } from "./main.js";

const args = process.argv.slice(2);

// Handle `pi update` before anything else
if (args[0] === "update") {
	handleUpdate().then(() => process.exit(0));
} else {
	main(args);
}
