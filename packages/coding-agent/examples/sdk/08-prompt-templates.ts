/**
 * Prompt Templates
 *
 * File-based templates that inject content when invoked with /templatename.
 */

import {
	createAgentSession,
	discoverPromptTemplates,
	type PromptTemplate,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

// Discover templates from cwd/.pi/prompts/ and ~/.pi/agent/prompts/
const discovered = discoverPromptTemplates();
console.log("Discovered prompt templates:");
for (const template of discovered) {
	console.log(`  /${template.name}: ${template.description}`);
}

// Define custom templates
const deployTemplate: PromptTemplate = {
	name: "deploy",
	description: "Deploy the application",
	source: "(custom)",
	content: `# Deploy Instructions

1. Build: npm run build
2. Test: npm test
3. Deploy: npm run deploy`,
};

// Use discovered + custom templates
await createAgentSession({
	promptTemplates: [...discovered, deployTemplate],
	sessionManager: SessionManager.inMemory(),
});

console.log(`Session created with ${discovered.length + 1} prompt templates`);

// Disable prompt templates:
// promptTemplates: []
