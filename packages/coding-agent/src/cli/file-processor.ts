/**
 * Process @file CLI arguments into text content and media attachments
 */

import { access, readFile, stat } from "node:fs/promises";
import type { ImageContent, VideoContent } from "@earendil-works/pi-ai";
import chalk from "chalk";
import { resolve } from "path";
import { resolveReadPath } from "../core/tools/path-utils.ts";
import { processImage } from "../utils/image-process.ts";
import {
	detectSupportedImageMimeTypeFromFile,
	detectSupportedVideoMimeTypeFromFile,
	MAX_VIDEO_BYTES,
} from "../utils/mime.ts";
import { stripBom } from "../utils/text.ts";

export interface ProcessedFiles {
	text: string;
	images: ImageContent[];
	videos: VideoContent[];
}

export interface ProcessFileOptions {
	/** Whether to auto-resize images. Default: true */
	autoResizeImages?: boolean;
}

/** Process @file arguments into text content and media attachments */
export async function processFileArguments(fileArgs: string[], options?: ProcessFileOptions): Promise<ProcessedFiles> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	let text = "";
	const images: ImageContent[] = [];
	const videos: VideoContent[] = [];

	for (const fileArg of fileArgs) {
		// Expand and resolve path (handles ~ expansion and macOS screenshot Unicode spaces)
		const absolutePath = resolve(resolveReadPath(fileArg, process.cwd()));

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
		const videoMimeType = mimeType ? null : await detectSupportedVideoMimeTypeFromFile(absolutePath);

		if (mimeType) {
			// Handle image file
			const content = await readFile(absolutePath);
			const processed = await processImage(content, mimeType, { autoResizeImages });

			if (!processed.ok) {
				text += `<file name="${absolutePath}">${processed.message}</file>\n`;
				continue;
			}

			const attachment: ImageContent = {
				type: "image",
				mimeType: processed.mimeType,
				data: processed.data,
			};
			images.push(attachment);

			// Add text reference to image with optional processing hints
			if (processed.hints.length > 0) {
				text += `<file name="${absolutePath}">${processed.hints.join("\n")}</file>\n`;
			} else {
				text += `<file name="${absolutePath}"></file>\n`;
			}
		} else if (videoMimeType) {
			if (stats.size > MAX_VIDEO_BYTES) {
				console.error(
					chalk.red(
						`Error: Video file exceeds ${MAX_VIDEO_BYTES / (1024 * 1024)}MB attachment limit: ${absolutePath}`,
					),
				);
				process.exit(1);
			}
			const content = await readFile(absolutePath);
			videos.push({
				type: "video",
				mimeType: videoMimeType,
				data: content.toString("base64"),
			});
			text += `<file name="${absolutePath}"></file>\n`;
		} else {
			// Handle text file
			try {
				const content = stripBom(await readFile(absolutePath, "utf-8"));
				text += `<file name="${absolutePath}">\n${content}\n</file>\n`;
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Error: Could not read file ${absolutePath}: ${message}`));
				process.exit(1);
			}
		}
	}

	return { text, images, videos };
}
