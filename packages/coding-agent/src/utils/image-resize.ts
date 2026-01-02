import type { ImageContent } from "@mariozechner/pi-ai";

export interface ImageResizeOptions {
	maxWidth?: number; // Default: 2000
	maxHeight?: number; // Default: 2000
	jpegQuality?: number; // Default: 80
}

export interface ResizedImage {
	data: string; // base64
	mimeType: string;
	originalWidth: number;
	originalHeight: number;
	width: number;
	height: number;
	wasResized: boolean;
}

const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
	maxWidth: 2000,
	maxHeight: 2000,
	jpegQuality: 80,
};

/**
 * Resize an image to fit within the specified max dimensions.
 * Returns the original image if it already fits within the limits.
 *
 * Uses sharp for image processing. If sharp is not available (e.g., in some
 * environments), returns the original image unchanged.
 */
export async function resizeImage(img: ImageContent, options?: ImageResizeOptions): Promise<ResizedImage> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const buffer = Buffer.from(img.data, "base64");

	let sharp: typeof import("sharp") | undefined;
	try {
		sharp = (await import("sharp")).default;
	} catch {
		// Sharp not available - return original image
		// We can't get dimensions without sharp, so return 0s
		return {
			data: img.data,
			mimeType: img.mimeType,
			originalWidth: 0,
			originalHeight: 0,
			width: 0,
			height: 0,
			wasResized: false,
		};
	}

	const sharpImg = sharp(buffer);
	const metadata = await sharpImg.metadata();

	const width = metadata.width ?? 0;
	const height = metadata.height ?? 0;
	const format = metadata.format ?? img.mimeType?.split("/")[1] ?? "png";

	// Check if already within limits
	if (width <= opts.maxWidth && height <= opts.maxHeight) {
		return {
			data: img.data,
			mimeType: img.mimeType ?? `image/${format}`,
			originalWidth: width,
			originalHeight: height,
			width,
			height,
			wasResized: false,
		};
	}

	// Calculate new dimensions maintaining aspect ratio
	let newWidth = width;
	let newHeight = height;

	if (newWidth > opts.maxWidth) {
		newHeight = Math.round((newHeight * opts.maxWidth) / newWidth);
		newWidth = opts.maxWidth;
	}
	if (newHeight > opts.maxHeight) {
		newWidth = Math.round((newWidth * opts.maxHeight) / newHeight);
		newHeight = opts.maxHeight;
	}

	// Resize the image
	const resized = await sharp(buffer)
		.resize(newWidth, newHeight, { fit: "inside", withoutEnlargement: true })
		.toBuffer();

	// Determine output format - preserve original if possible, otherwise use JPEG
	let outputMimeType: string;
	let outputBuffer: Buffer;

	if (format === "jpeg" || format === "jpg") {
		outputBuffer = await sharp(resized).jpeg({ quality: opts.jpegQuality }).toBuffer();
		outputMimeType = "image/jpeg";
	} else if (format === "png") {
		outputBuffer = resized;
		outputMimeType = "image/png";
	} else if (format === "gif") {
		// GIF resize might not preserve animation; convert to PNG for quality
		outputBuffer = resized;
		outputMimeType = "image/png";
	} else if (format === "webp") {
		outputBuffer = resized;
		outputMimeType = "image/webp";
	} else {
		// Default to JPEG for unknown formats
		outputBuffer = await sharp(resized).jpeg({ quality: opts.jpegQuality }).toBuffer();
		outputMimeType = "image/jpeg";
	}

	return {
		data: outputBuffer.toString("base64"),
		mimeType: outputMimeType,
		originalWidth: width,
		originalHeight: height,
		width: newWidth,
		height: newHeight,
		wasResized: true,
	};
}

/**
 * Format a dimension note for resized images.
 * This helps the model understand the coordinate mapping.
 */
export function formatDimensionNote(result: ResizedImage): string | undefined {
	if (!result.wasResized) {
		return undefined;
	}

	const scale = result.originalWidth / result.width;
	return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}
