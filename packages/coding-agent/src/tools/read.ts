import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
});

export const readTool: AgentTool<typeof readSchema> = {
	name: "read",
	label: "read",
	description: "Read the contents of a file. Returns the full file content as text.",
	parameters: readSchema,
	execute: async (_toolCallId: string, { path }: { path: string }) => {
		try {
			const absolutePath = resolve(path);

			if (!existsSync(absolutePath)) {
				return { output: `Error: File not found: ${path}`, details: undefined };
			}

			const content = readFileSync(absolutePath, "utf-8");
			return { output: content, details: undefined };
		} catch (error: any) {
			return { output: `Error reading file: ${error.message}`, details: undefined };
		}
	},
};
