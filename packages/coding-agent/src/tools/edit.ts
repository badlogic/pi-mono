import * as os from "node:os";
import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access, readFile, writeFile } from "fs/promises";
import { resolve as resolvePath } from "path";

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
		signal?: AbortSignal,
	) => {
		const absolutePath = resolvePath(expandPath(path));

		return new Promise<{ output: string; details: undefined }>((resolve, reject) => {
			// Check if already aborted
			if (signal?.aborted) {
				reject(new Error("Operation aborted"));
				return;
			}

			let aborted = false;

			// Set up abort handler
			const onAbort = () => {
				aborted = true;
				reject(new Error("Operation aborted"));
			};

			if (signal) {
				signal.addEventListener("abort", onAbort, { once: true });
			}

			// Perform the edit operation
			(async () => {
				try {
					// Check if file exists
					try {
						await access(absolutePath, constants.R_OK | constants.W_OK);
					} catch {
						if (signal) {
							signal.removeEventListener("abort", onAbort);
						}
						reject(new Error(`File not found: ${path}`));
						return;
					}

					// Check if aborted before reading
					if (aborted) {
						return;
					}

					// Read the file
					const content = await readFile(absolutePath, "utf-8");

					// Check if aborted after reading
					if (aborted) {
						return;
					}

					// Check if old text exists
					if (!content.includes(oldText)) {
						if (signal) {
							signal.removeEventListener("abort", onAbort);
						}
						reject(
							new Error(
								`Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
							),
						);
						return;
					}

					// Count occurrences
					const occurrences = content.split(oldText).length - 1;

					if (occurrences > 1) {
						if (signal) {
							signal.removeEventListener("abort", onAbort);
						}
						reject(
							new Error(
								`Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
							),
						);
						return;
					}

					// Check if aborted before writing
					if (aborted) {
						return;
					}

					// Perform replacement
					const newContent = content.replace(oldText, newText);
					await writeFile(absolutePath, newContent, "utf-8");

					// Check if aborted after writing
					if (aborted) {
						return;
					}

					// Clean up abort handler
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					resolve({
						output: `Successfully replaced text in ${path}. Changed ${oldText.length} characters to ${newText.length} characters.`,
						details: undefined,
					});
				} catch (error: any) {
					// Clean up abort handler
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					if (!aborted) {
						reject(error);
					}
				}
			})();
		});
	},
};
