import type { ImageContent } from "@mariozechner/pi-ai";

export interface PendingClipboardImage {
	id: number;
	image: ImageContent;
	path: string;
}

/**
 * Find all [image #N] marker IDs in text.
 */
export function findImageMarkerIds(text: string): Set<number> {
	const markerRegex = /\[image #(\d+)\]/gi;
	const foundIds = new Set<number>();
	const matches = text.matchAll(markerRegex);
	for (const match of matches) {
		foundIds.add(parseInt(match[1], 10));
	}
	return foundIds;
}

/**
 * Filter pending images to only those with markers present in text.
 */
export function filterImagesByMarkers(pendingImages: PendingClipboardImage[], text: string): PendingClipboardImage[] {
	const foundIds = findImageMarkerIds(text);
	return pendingImages.filter((p) => foundIds.has(p.id));
}

/**
 * Prepare images for submission based on markers in text and model capabilities.
 * Returns the images to send (or undefined if none/model doesn't support).
 */
export function prepareImagesForSubmit(
	pendingImages: PendingClipboardImage[],
	text: string,
	modelSupportsImages: boolean,
): { text: string; images: ImageContent[] | undefined } {
	if (pendingImages.length === 0) {
		return { text, images: undefined };
	}

	const imagesToSend = filterImagesByMarkers(pendingImages, text);

	if (imagesToSend.length === 0) {
		return { text, images: undefined };
	}

	if (modelSupportsImages) {
		return { text, images: imagesToSend.map((p) => p.image) };
	}

	// Model doesn't support images
	return { text, images: undefined };
}

/**
 * Restore pending clipboard images from session images and editor text.
 * Matches [image #N] markers in text with images from the session.
 * Images are stored in order in the session, markers reference by ID.
 * Returns the restored pending images and the highest ID found (for counter reset).
 */
export function restoreImagesFromSession(
	sessionImages: ImageContent[],
	text: string,
): { pendingImages: PendingClipboardImage[]; maxId: number } {
	if (sessionImages.length === 0) {
		return { pendingImages: [], maxId: 0 };
	}

	// Find all marker IDs in the text, sorted
	const markerIds = Array.from(findImageMarkerIds(text)).sort((a, b) => a - b);

	if (markerIds.length === 0) {
		return { pendingImages: [], maxId: 0 };
	}

	// Match markers with images (images are stored in order of their markers)
	const pendingImages: PendingClipboardImage[] = [];
	for (let i = 0; i < Math.min(markerIds.length, sessionImages.length); i++) {
		const id = markerIds[i];
		const image = sessionImages[i];
		pendingImages.push({
			id,
			image,
			path: "(restored from session)",
		});
	}

	const maxId = markerIds.length > 0 ? Math.max(...markerIds) : 0;
	return { pendingImages, maxId };
}
