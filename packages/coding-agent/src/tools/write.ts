import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

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
	execute: async (_toolCallId: string, { path, content }: { path: string; content: string }) => {
		try {
			const absolutePath = resolve(path);
			const dir = dirname(absolutePath);

			// Create parent directories if needed
			mkdirSync(dir, { recursive: true });

			writeFileSync(absolutePath, content, "utf-8");
			return { output: `Successfully wrote ${content.length} bytes to ${path}`, details: undefined };
		} catch (error: any) {
			return { output: `Error writing file: ${error.message}`, details: undefined };
		}
	},
};
