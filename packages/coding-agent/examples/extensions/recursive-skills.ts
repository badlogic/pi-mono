import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SettingsManager } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	// Optional: gate recursive discovery behind flags (disabled by default).
	// pi.registerFlag("recursive-skills-pi", {
	// 	description: "Enable recursive .pi/skills discovery",
	// 	type: "boolean",
	// 	default: false,
	// });
	// pi.registerFlag("recursive-skills-claude", {
	// 	description: "Enable recursive .claude/skills discovery",
	// 	type: "boolean",
	// 	default: false,
	// });

	pi.on("skills_discover", (event) => {
		const skillsSettings = SettingsManager.create(event.cwd).getSkillsSettings();
		const includePi = skillsSettings.enablePiProject;
		const includeClaude = skillsSettings.enableClaudeProject;
		// If you prefer flag-gated discovery, replace the two lines above with:
		// const includePi = pi.getFlag("recursive-skills-pi") === true;
		// const includeClaude = pi.getFlag("recursive-skills-claude") === true;
		const directories = new Set<string>();
		let current = event.cwd;

		// Walk up the directory tree to find parent skills directories.
		while (true) {
			if (includePi) {
				const piSkillsDir = join(current, ".pi", "skills");
				if (existsSync(piSkillsDir)) {
					directories.add(piSkillsDir);
				}
			}

			if (includeClaude) {
				const claudeSkillsDir = join(current, ".claude", "skills");
				if (existsSync(claudeSkillsDir)) {
					directories.add(claudeSkillsDir);
				}
			}

			const parent = dirname(current);
			if (parent === current) {
				break;
			}
			current = parent;
		}

		return { additionalDirectories: Array.from(directories) };
	});
}
