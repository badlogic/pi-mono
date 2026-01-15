import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("skills_discover", (event) => {
		const directories = new Set<string>();
		let current = event.cwd;

		// Walk up the directory tree to find parent skills directories.
		while (true) {
			const piSkillsDir = join(current, ".pi", "skills");
			if (existsSync(piSkillsDir)) {
				directories.add(piSkillsDir);
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
