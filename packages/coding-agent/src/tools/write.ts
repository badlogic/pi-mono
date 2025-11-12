import * as os from "node:os";
import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve as resolvePath } from "path";

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
		const absolutePath = resolvePath(expandPath(path));
		const dir = dirname(absolutePath);

		return new Promise<{ content: Array<{ type: "text"; text: string }>; details: undefined }>((resolve, reject) => {
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

			// Perform the write operation
			(async () => {
				try {
					// Create parent directories if needed
					await mkdir(dir, { recursive: true });

					// Check if aborted before writing
					if (aborted) {
						return;
					}

					// Write the file
					await writeFile(absolutePath, content, "utf-8");

					// Check if aborted after writing
					if (aborted) {
						return;
					}

					// Clean up abort handler
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					resolve({
						content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
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
