import * as os from "node:os";
import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

/**
 * Expand ~ to home directory
 */
function expandPath(filePath: string): string {
	if (filePath === "~") {
		return os.homedir();
	}
	if (filePath.startsWith("~/")) {
		return os.homedir() + filePath.slice(1);
	}
	return filePath;
}

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
});

export const readTool: AgentTool<typeof readSchema> = {
	name: "read",
	label: "read",
	description: "Read the contents of a file. Returns the full file content as text.",
	parameters: readSchema,
	execute: async (_toolCallId: string, { path }: { path: string }) => {
		const absolutePath = resolve(expandPath(path));

		if (!existsSync(absolutePath)) {
			throw new Error(`File not found: ${path}`);
		}

		const content = readFileSync(absolutePath, "utf-8");
		return { output: content, details: undefined };
	},
};
