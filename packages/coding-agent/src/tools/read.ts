import * as os from "node:os";
import type { AgentTool, ImageContent, TextContent } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { constants } from "fs";
import { access, readFile } from "fs/promises";
import { extname, resolve as resolvePath } from "path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, type TruncationResult, truncateHead } from "./truncate.js";

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
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

interface ReadToolDetails {
	truncation?: TruncationResult;
}

export const readTool: AgentTool<typeof readSchema> = {
	name: "read",
	label: "read",
	description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files.`,
	parameters: readSchema,
	execute: async (
		_toolCallId: string,
		{ path, offset, limit }: { path: string; offset?: number; limit?: number },
		signal?: AbortSignal,
	) => {
		const absolutePath = resolvePath(expandPath(path));
		const mimeType = isImageFile(absolutePath);

		return new Promise<{ content: (TextContent | ImageContent)[]; details: ReadToolDetails | undefined }>(
			(resolve, reject) => {
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
						await access(absolutePath, constants.R_OK);

						// Check if aborted before reading
						if (aborted) {
							return;
						}

						// Read the file based on type
						let content: (TextContent | ImageContent)[];
						let details: ReadToolDetails | undefined;

						if (mimeType) {
							// Read as image (binary)
							const buffer = await readFile(absolutePath);
							const base64 = buffer.toString("base64");

							content = [
								{ type: "text", text: `Read image file [${mimeType}]` },
								{ type: "image", data: base64, mimeType },
							];
						} else {
							// Read as text
							const textContent = await readFile(absolutePath, "utf-8");
							const lines = textContent.split("\n");

							// Apply offset if specified (1-indexed to 0-indexed)
							const startLine = offset ? Math.max(0, offset - 1) : 0;

							// Check if offset is out of bounds
							if (startLine >= lines.length) {
								throw new Error(`Offset ${offset} is beyond end of file (${lines.length} lines total)`);
							}

							// If limit is specified by user, use it; otherwise we'll let truncateHead decide
							let selectedContent: string;
							if (limit !== undefined) {
								const endLine = Math.min(startLine + limit, lines.length);
								selectedContent = lines.slice(startLine, endLine).join("\n");
							} else {
								selectedContent = lines.slice(startLine).join("\n");
							}

							// Apply truncation (respects both line and byte limits)
							const truncation = truncateHead(selectedContent);

							let outputText = truncation.content;

							// Add continuation hint if there's more content after our selection
							// (only relevant when user specified limit and there's more in the file)
							if (limit !== undefined && startLine + limit < lines.length && !truncation.truncated) {
								const remaining = lines.length - (startLine + limit);
								outputText += `\n\n[${remaining} more lines in file. Use offset=${startLine + limit + 1} to continue]`;
							}

							content = [{ type: "text", text: outputText }];

							// Include truncation info in details if truncation occurred
							if (truncation.truncated) {
								details = { truncation };
							}
						}

						// Check if aborted after reading
						if (aborted) {
							return;
						}

						// Clean up abort handler
						if (signal) {
							signal.removeEventListener("abort", onAbort);
						}

						resolve({ content, details });
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
			},
		);
	},
};
