/**
 * Skills Configuration
 *
 * Skills provide specialized instructions loaded into the system prompt.
 * Discover, filter, merge, or replace them.
 */

import { createAgentSession, DefaultResourceLoader, SessionManager, type Skill } from "@mariozechner/pi-coding-agent";

// Or define custom skills inline
const customSkill: Skill = {
	name: "my-skill",
	description: "Custom project instructions",
	filePath: "/virtual/SKILL.md",
	baseDir: "/virtual",
	source: "custom",
};

const loader = new DefaultResourceLoader({
	skillsOverride: (current) => {
		const filteredSkills = current.skills.filter((s) => s.name.includes("browser") || s.name.includes("search"));
		return {
			skills: [...filteredSkills, customSkill],
			diagnostics: current.diagnostics,
		};
	},
});
await loader.reload();

// Discover all skills from cwd/.pi/skills, ~/.pi/agent/skills, etc.
const discovered = loader.getSkills();
console.log(
	"Discovered skills:",
	discovered.skills.map((s) => s.name),
);
if (discovered.diagnostics.length > 0) {
	console.log("Warnings:", discovered.diagnostics);
}

await createAgentSession({
	resourceLoader: loader,
	sessionManager: SessionManager.inMemory(),
});

console.log("Session created with filtered skills");
