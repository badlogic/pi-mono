import { existsSync } from "fs";

/**
 * Get shell configuration based on platform
 */
export function getShellConfig(): { shell: string; args: string[] } {
	if (process.platform === "win32") {
		const paths: string[] = [];
		const programFiles = process.env.ProgramFiles;
		if (programFiles) {
			paths.push(`${programFiles}\\Git\\bin\\bash.exe`);
		}
		const programFilesX86 = process.env["ProgramFiles(x86)"];
		if (programFilesX86) {
			paths.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
		}

		for (const path of paths) {
			if (existsSync(path)) {
				return { shell: path, args: ["-c"] };
			}
		}

		throw new Error(
			`Git Bash not found. Please install Git for Windows from https://git-scm.com/download/win\n` +
				`Searched in:\n${paths.map((p) => `  ${p}`).join("\n")}`,
		);
	}
	return { shell: "sh", args: ["-c"] };
}
