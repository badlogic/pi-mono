import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const editSchema = Type.Object({
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
	newText: Type.String({ description: "New text to replace the old text with" }),
});

export const editTool: AgentTool<typeof editSchema> = {
	name: "edit",
	label: "edit",
	description:
		"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
	parameters: editSchema,
	execute: async (
		_toolCallId: string,
		{ path, oldText, newText }: { path: string; oldText: string; newText: string },
	) => {
		try {
			const absolutePath = resolve(path);

			if (!existsSync(absolutePath)) {
				return { output: `Error: File not found: ${path}`, details: undefined };
			}

			const content = readFileSync(absolutePath, "utf-8");

			// Check if old text exists
			if (!content.includes(oldText)) {
				return {
					output: `Error: Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
					details: undefined,
				};
			}

			// Count occurrences
			const occurrences = content.split(oldText).length - 1;

			if (occurrences > 1) {
				return {
					output: `Error: Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
					details: undefined,
				};
			}

			// Perform replacement
			const newContent = content.replace(oldText, newText);
			writeFileSync(absolutePath, newContent, "utf-8");

			return {
				output: `Successfully replaced text in ${path}. Changed ${oldText.length} characters to ${newText.length} characters.`,
				details: undefined,
			};
		} catch (error: any) {
			return { output: `Error editing file: ${error.message}`, details: undefined };
		}
	},
};
