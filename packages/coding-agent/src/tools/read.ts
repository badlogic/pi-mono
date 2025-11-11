import * as os from "node:os";
import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access, readFile } from "fs/promises";
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

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
});

export const readTool: AgentTool<typeof readSchema> = {
	name: "read",
	label: "read",
	description: "Read the contents of a file. Returns the full file content as text.",
	parameters: readSchema,
	execute: async (_toolCallId: string, { path }: { path: string }, signal?: AbortSignal) => {
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

			// Perform the read operation
			(async () => {
				try {
					// Check if file exists
					try {
						await access(absolutePath, constants.R_OK);
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

					// Clean up abort handler
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					resolve({ output: content, details: undefined });
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
