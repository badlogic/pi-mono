import * as os from "node:os";
import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync, writeFileSync } from "fs";
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
		const absolutePath = resolve(expandPath(path));

		if (!existsSync(absolutePath)) {
			throw new Error(`File not found: ${path}`);
		}

		const content = readFileSync(absolutePath, "utf-8");

		// Check if old text exists
		if (!content.includes(oldText)) {
			throw new Error(
				`Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
			);
		}

		// Count occurrences
		const occurrences = content.split(oldText).length - 1;

		if (occurrences > 1) {
			throw new Error(
				`Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
			);
		}

		// Perform replacement
		const newContent = content.replace(oldText, newText);
		writeFileSync(absolutePath, newContent, "utf-8");

		return {
			output: `Successfully replaced text in ${path}. Changed ${oldText.length} characters to ${newText.length} characters.`,
			details: undefined,
		};
	},
};
