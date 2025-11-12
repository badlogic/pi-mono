import * as os from "node:os";
import type { AgentTool, ImageContent, TextContent } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access, readFile } from "fs/promises";
import { extname, resolve as resolvePath } from "path";

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

/**
 * Map of file extensions to MIME types for common image formats
 */
const IMAGE_MIME_TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".svg": "image/svg+xml",
};

/**
 * Check if a file is an image based on its extension
 */
function isImageFile(filePath: string): string | null {
	const ext = extname(filePath).toLowerCase();
	return IMAGE_MIME_TYPES[ext] || null;
}

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
});

export const readTool: AgentTool<typeof readSchema> = {
	name: "read",
	label: "read",
	description:
		"Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp, svg). Images are sent as attachments to the model.",
	parameters: readSchema,
	execute: async (_toolCallId: string, { path }: { path: string }, signal?: AbortSignal) => {
		const absolutePath = resolvePath(expandPath(path));
		const mimeType = isImageFile(absolutePath);

		return new Promise<{ content: (TextContent | ImageContent)[]; details: undefined }>((resolve, reject) => {
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
						resolve({
							content: [{ type: "text", text: `Error: File not found: ${path}` }],
							details: undefined,
						});
						return;
					}

					// Check if aborted before reading
					if (aborted) {
						return;
					}

					// Read the file based on type
					let content: (TextContent | ImageContent)[];

					if (mimeType) {
						// Read as image (binary)
						const buffer = await readFile(absolutePath);
						const base64 = buffer.toString("base64");

						content = [
							{ type: "text", text: `Read image file: ${path}` },
							{ type: "image", data: base64, mimeType },
						];
					} else {
						// Read as text
						const textContent = await readFile(absolutePath, "utf-8");
						content = [{ type: "text", text: textContent }];
					}

					// Check if aborted after reading
					if (aborted) {
						return;
					}

					// Clean up abort handler
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					resolve({ content, details: undefined });
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
