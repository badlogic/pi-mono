/**
 * Slash Commands
 *
 * File-based commands that inject content when invoked with /commandname.
 */

import { createAgentSession, discoverSlashCommands, SessionManager, type FileSlashCommand } from "../../src/index.js";

// Discover commands from cwd/.pi/commands/ and ~/.pi/agent/commands/
const discovered = discoverSlashCommands();
console.log("Discovered slash commands:");
for (const cmd of discovered) {
	console.log(`  /${cmd.name}: ${cmd.description}`);
}

// Define custom commands
const deployCommand: FileSlashCommand = {
	name: "deploy",
	description: "Deploy the application",
	source: "(custom)",
	content: `# Deploy Instructions

1. Build: npm run build
2. Test: npm test  
3. Deploy: npm run deploy`,
};

// Use discovered + custom commands
const { session } = await createAgentSession({
	slashCommands: [...discovered, deployCommand],
	sessionManager: SessionManager.inMemory(),
});

console.log(`Session created with ${discovered.length + 1} slash commands`);

// Disable slash commands:
// slashCommands: []
