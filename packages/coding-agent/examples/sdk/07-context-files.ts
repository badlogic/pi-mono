/**
 * Context Files (AGENTS.md)
 *
 * Context files provide project-specific instructions loaded into the system prompt.
 */

import { createAgentSession, discoverContextFiles, SessionManager } from "../../src/index.js";

// Discover AGENTS.md files walking up from cwd
const discovered = discoverContextFiles();
console.log("Discovered context files:");
for (const file of discovered) {
	console.log(`  - ${file.path} (${file.content.length} chars)`);
}

// Use custom context files
const { session } = await createAgentSession({
	contextFiles: [
		...discovered,
		{
			path: "/virtual/AGENTS.md",
			content: `# Project Guidelines

## Code Style
- Use TypeScript strict mode
- No any types
- Prefer const over let`,
		},
	],
	sessionManager: SessionManager.inMemory(),
});

console.log(`Session created with ${discovered.length + 1} context files`);

// Disable context files:
// contextFiles: []
