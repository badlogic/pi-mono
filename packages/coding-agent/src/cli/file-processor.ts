/**
 * Process @file CLI arguments into text content and file attachments
 */

import type { Attachment } from "@mariozechner/pi-agent-core";
import chalk from "chalk";
import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { basename, extname, resolve } from "path";

/** Map of file extensions to MIME types for common image formats */
const IMAGE_MIME_TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
};

/** Map of file extensions to MIME types for document formats */
const DOCUMENT_MIME_TYPES: Record<string, string> = {
	".pdf": "application/pdf",
};

/** Check if a file is an image based on its extension, returns MIME type or null */
function isImageFile(filePath: string): string | null {
	const ext = extname(filePath).toLowerCase();
	return IMAGE_MIME_TYPES[ext] || null;
}

/** Check if a file is a document based on its extension, returns MIME type or null */
function isDocumentFile(filePath: string): string | null {
	const ext = extname(filePath).toLowerCase();
	return DOCUMENT_MIME_TYPES[ext] || null;
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
	attachments: Attachment[];
}

/** Process @file arguments into text content and file attachments */
export function processFileArguments(fileArgs: string[]): ProcessedFiles {
	let textContent = "";
	const attachments: Attachment[] = [];

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

		const imageMimeType = isImageFile(absolutePath);
		const documentMimeType = isDocumentFile(absolutePath);

		if (imageMimeType) {
			// Handle image file
			const content = readFileSync(absolutePath);
			const base64Content = content.toString("base64");

			const attachment: Attachment = {
				id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
				type: "image",
				fileName: basename(absolutePath),
				mimeType: imageMimeType,
				size: stats.size,
				content: base64Content,
			};

			attachments.push(attachment);

			// Add text reference to image
			textContent += `<file name="${absolutePath}"></file>\n`;
		} else if (documentMimeType) {
			// Handle document file (PDF) - read as binary and attach
			const content = readFileSync(absolutePath);
			const base64Content = content.toString("base64");

			const attachment: Attachment = {
				id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
				type: "document",
				fileName: basename(absolutePath),
				mimeType: documentMimeType,
				size: stats.size,
				content: base64Content,
			};

			attachments.push(attachment);

			// Add text reference to document
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

	return { textContent, attachments };
}
