import type { ImageContent } from "@mariozechner/pi-ai";
import { getVips } from "./vips.js";

export interface ImageResizeOptions {
	maxWidth?: number; // Default: 2000
	maxHeight?: number; // Default: 2000
	maxBytes?: number; // Default: 4.5MB (below Anthropic's 5MB limit)
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

// 4.5MB - provides headroom below Anthropic's 5MB limit
const DEFAULT_MAX_BYTES = 4.5 * 1024 * 1024;

const DEFAULT_OPTIONS: Required<ImageResizeOptions> = {
	maxWidth: 2000,
	maxHeight: 2000,
	maxBytes: DEFAULT_MAX_BYTES,
	jpegQuality: 80,
};

/** Helper to pick the smaller of two buffers */
function pickSmaller(
	a: { buffer: Uint8Array; mimeType: string },
	b: { buffer: Uint8Array; mimeType: string },
): { buffer: Uint8Array; mimeType: string } {
	return a.buffer.length <= b.buffer.length ? a : b;
}

/**
 * Resize an image to fit within the specified max dimensions and file size.
 * Returns the original image if it already fits within the limits.
 *
 * Uses wasm-vips for image processing. If wasm-vips is not available (e.g., in some
 * environments), returns the original image unchanged.
 *
 * Strategy for staying under maxBytes:
 * 1. First resize to maxWidth/maxHeight
 * 2. Try both PNG and JPEG formats, pick the smaller one
 * 3. If still too large, try JPEG with decreasing quality
 * 4. If still too large, progressively reduce dimensions
 */
export async function resizeImage(img: ImageContent, options?: ImageResizeOptions): Promise<ResizedImage> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const buffer = Buffer.from(img.data, "base64");

	const vipsOrNull = await getVips();
	if (!vipsOrNull) {
		// wasm-vips not available - return original image
		// We can't get dimensions without vips, so return 0s
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
	// Capture non-null reference for use in nested functions
	const vips = vipsOrNull;

	// Load image to get metadata
	let sourceImg: InstanceType<typeof vips.Image>;
	try {
		sourceImg = vips.Image.newFromBuffer(buffer);
	} catch {
		// Failed to load image
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

	const originalWidth = sourceImg.width;
	const originalHeight = sourceImg.height;

	// Check if already within all limits (dimensions AND size)
	const originalSize = buffer.length;
	if (originalWidth <= opts.maxWidth && originalHeight <= opts.maxHeight && originalSize <= opts.maxBytes) {
		sourceImg.delete();
		const format = img.mimeType?.split("/")[1] ?? "png";
		return {
			data: img.data,
			mimeType: img.mimeType ?? `image/${format}`,
			originalWidth,
			originalHeight,
			width: originalWidth,
			height: originalHeight,
			wasResized: false,
		};
	}

	// Calculate initial dimensions respecting max limits
	let targetWidth = originalWidth;
	let targetHeight = originalHeight;

	if (targetWidth > opts.maxWidth) {
		targetHeight = Math.round((targetHeight * opts.maxWidth) / targetWidth);
		targetWidth = opts.maxWidth;
	}
	if (targetHeight > opts.maxHeight) {
		targetWidth = Math.round((targetWidth * opts.maxHeight) / targetHeight);
		targetHeight = opts.maxHeight;
	}

	// Helper to resize and encode in both formats, returning the smaller one
	function tryBothFormats(
		width: number,
		height: number,
		jpegQuality: number,
	): { buffer: Uint8Array; mimeType: string } {
		// Load image fresh and resize using scale factor
		// (Using newFromBuffer + resize instead of thumbnailBuffer to avoid lazy re-read issues)
		const img = vips.Image.newFromBuffer(buffer);
		const scale = Math.min(width / img.width, height / img.height);
		const resized = scale < 1 ? img.resize(scale) : img;

		const pngBuffer = resized.writeToBuffer(".png");
		const jpegBuffer = resized.writeToBuffer(".jpg", { Q: jpegQuality });

		if (resized !== img) {
			resized.delete();
		}
		img.delete();

		return pickSmaller({ buffer: pngBuffer, mimeType: "image/png" }, { buffer: jpegBuffer, mimeType: "image/jpeg" });
	}

	// Clean up the source image
	sourceImg.delete();

	// Try to produce an image under maxBytes
	const qualitySteps = [85, 70, 55, 40];
	const scaleSteps = [1.0, 0.75, 0.5, 0.35, 0.25];

	let best: { buffer: Uint8Array; mimeType: string };
	let finalWidth = targetWidth;
	let finalHeight = targetHeight;

	// First attempt: resize to target dimensions, try both formats
	best = tryBothFormats(targetWidth, targetHeight, opts.jpegQuality);

	if (best.buffer.length <= opts.maxBytes) {
		return {
			data: Buffer.from(best.buffer).toString("base64"),
			mimeType: best.mimeType,
			originalWidth,
			originalHeight,
			width: finalWidth,
			height: finalHeight,
			wasResized: true,
		};
	}

	// Still too large - try JPEG with decreasing quality (and compare to PNG each time)
	for (const quality of qualitySteps) {
		best = tryBothFormats(targetWidth, targetHeight, quality);

		if (best.buffer.length <= opts.maxBytes) {
			return {
				data: Buffer.from(best.buffer).toString("base64"),
				mimeType: best.mimeType,
				originalWidth,
				originalHeight,
				width: finalWidth,
				height: finalHeight,
				wasResized: true,
			};
		}
	}

	// Still too large - reduce dimensions progressively
	for (const scale of scaleSteps) {
		finalWidth = Math.round(targetWidth * scale);
		finalHeight = Math.round(targetHeight * scale);

		// Skip if dimensions are too small
		if (finalWidth < 100 || finalHeight < 100) {
			break;
		}

		for (const quality of qualitySteps) {
			best = tryBothFormats(finalWidth, finalHeight, quality);

			if (best.buffer.length <= opts.maxBytes) {
				return {
					data: Buffer.from(best.buffer).toString("base64"),
					mimeType: best.mimeType,
					originalWidth,
					originalHeight,
					width: finalWidth,
					height: finalHeight,
					wasResized: true,
				};
			}
		}
	}

	// Last resort: return smallest version we produced even if over limit
	// (the API will reject it, but at least we tried everything)
	return {
		data: Buffer.from(best.buffer).toString("base64"),
		mimeType: best.mimeType,
		originalWidth,
		originalHeight,
		width: finalWidth,
		height: finalHeight,
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
