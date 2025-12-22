/**
 * Skills Configuration
 *
 * Skills provide specialized instructions loaded into the system prompt.
 * Discover, filter, merge, or replace them.
 */

import { createAgentSession, discoverSkills, SessionManager, type Skill } from "../../src/index.js";

// Discover all skills from cwd/.pi/skills, ~/.pi/agent/skills, etc.
const allSkills = discoverSkills();
console.log(
	"Discovered skills:",
	allSkills.map((s) => s.name),
);

// Filter to specific skills
const filteredSkills = allSkills.filter((s) => s.name.includes("browser") || s.name.includes("search"));

// Or define custom skills inline
const customSkill: Skill = {
	name: "my-skill",
	description: "Custom project instructions",
	filePath: "/virtual/SKILL.md",
	baseDir: "/virtual",
	source: "custom",
};

// Use filtered + custom skills
const { session } = await createAgentSession({
	skills: [...filteredSkills, customSkill],
	sessionManager: SessionManager.inMemory(),
});

console.log(`Session created with ${filteredSkills.length + 1} skills`);

// To disable all skills:
// skills: []

// To use discovery with filtering via settings:
// discoverSkills(process.cwd(), undefined, {
//   ignoredSkills: ["browser-tools"],  // glob patterns to exclude
//   includeSkills: ["brave-*"],        // glob patterns to include (empty = all)
// })
