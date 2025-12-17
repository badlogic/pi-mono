/**
 * Process @file CLI arguments into text content and image attachments
 */

import { access, readFile, stat } from "node:fs/promises";
import type { Attachment } from "@mariozechner/pi-agent-core";
import chalk from "chalk";
import { resolve } from "path";
import { resolveReadPath } from "../core/tools/path-utils.js";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.js";

export interface ProcessedFiles {
	textContent: string;
	imageAttachments: Attachment[];
}

/** Process @file arguments into text content and image attachments */
export async function processFileArguments(fileArgs: string[]): Promise<ProcessedFiles> {
	let textContent = "";
	const imageAttachments: Attachment[] = [];

	for (const fileArg of fileArgs) {
		// Expand and resolve path (handles ~ expansion and macOS screenshot Unicode spaces)
		const absolutePath = resolve(resolveReadPath(fileArg));

		// Check if file exists
		try {
			await access(absolutePath);
		} catch {
			console.error(chalk.red(`Error: File not found: ${absolutePath}`));
			process.exit(1);
		}

		// Check if file is empty
		const stats = await stat(absolutePath);
		if (stats.size === 0) {
			// Skip empty files
			continue;
		}

		const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);

		if (mimeType) {
			// Handle image file
			const content = await readFile(absolutePath);
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
				const content = await readFile(absolutePath, "utf-8");
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
