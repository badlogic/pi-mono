/**
 * Process @file CLI arguments into text content and image attachments
 */

import type { Attachment } from "@mariozechner/pi-agent-core";
import chalk from "chalk";
import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { extname, resolve } from "path";

/** Map of file extensions to MIME types for common image formats */
const IMAGE_MIME_TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
};

/** Check if a file is an image based on its extension, returns MIME type or null */
function isImageFile(filePath: string): string | null {
	const ext = extname(filePath).toLowerCase();
	return IMAGE_MIME_TYPES[ext] || null;
}

/** Expand ~ to home directory */
function expandPath(filePath: string): string {
	if (filePath === "~") {
		return homedir();
	}
	if (filePath.startsWith("~/")) {
		return homedir() + filePath.slice(1);
	}
	return filePath;
}

export interface ProcessedFiles {
	textContent: string;
	imageAttachments: Attachment[];
}

/** Process @file arguments into text content and image attachments */
export function processFileArguments(fileArgs: string[]): ProcessedFiles {
	let textContent = "";
	const imageAttachments: Attachment[] = [];

	for (const fileArg of fileArgs) {
		// Expand and resolve path
		const expandedPath = expandPath(fileArg);
		const absolutePath = resolve(expandedPath);

		// Check if file exists
		if (!existsSync(absolutePath)) {
			console.error(chalk.red(`Error: File not found: ${absolutePath}`));
			process.exit(1);
		}

		// Check if file is empty
		const stats = statSync(absolutePath);
		if (stats.size === 0) {
			// Skip empty files
			continue;
		}

		const mimeType = isImageFile(absolutePath);

		if (mimeType) {
			// Handle image file
			const content = readFileSync(absolutePath);
			const base64Content = content.toString("base64");

			const attachment: Attachment = {
				id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
				type: "image",
				fileName: absolutePath.split("/").pop() || absolutePath,
				mimeType,
				size: stats.size,
				content: base64Content,
			};

			imageAttachments.push(attachment);

			// Add text reference to image
			textContent += `<file name="${absolutePath}"></file>\n`;
		} else {
			// Handle text file
			try {
				const content = readFileSync(absolutePath, "utf-8");
				textContent += `<file name="${absolutePath}">\n${content}\n</file>\n`;
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Error: Could not read file ${absolutePath}: ${message}`));
				process.exit(1);
			}
		}
	}

	return { textContent, imageAttachments };
}
