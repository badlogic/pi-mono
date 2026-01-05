/**
 * Example extension that uses a 3rd party dependency (chalk).
 * Tests that jiti can resolve npm modules correctly.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import chalk from "chalk";

export default function (pi: ExtensionAPI) {
	// Log with colors using chalk
	console.log(`${chalk.green("✓")} ${chalk.bold("chalk-logger extension loaded")}`);

	pi.on("agent_start", async () => {
		console.log(`${chalk.blue("[chalk-logger]")} Agent starting`);
	});

	pi.on("tool_call", async (event) => {
		console.log(`${chalk.yellow("[chalk-logger]")} Tool: ${chalk.cyan(event.toolName)}`);
		return undefined;
	});

	pi.on("agent_end", async (event) => {
		const count = event.messages.length;
		console.log(`${chalk.green("[chalk-logger]")} Done with ${chalk.bold(String(count))} messages`);
	});
}
