import * as os from "node:os";
import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

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

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export const writeTool: AgentTool<typeof writeSchema> = {
	name: "write",
	label: "write",
	description:
		"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
	parameters: writeSchema,
	execute: async (_toolCallId: string, { path, content }: { path: string; content: string }, signal?: AbortSignal) => {
		// Check if already aborted
		if (signal?.aborted) {
			throw new Error("Operation aborted");
		}

		const absolutePath = resolve(expandPath(path));
		const dir = dirname(absolutePath);

		// Create parent directories if needed
		mkdirSync(dir, { recursive: true });

		writeFileSync(absolutePath, content, "utf-8");
		return { output: `Successfully wrote ${content.length} bytes to ${path}`, details: undefined };
	},
};
