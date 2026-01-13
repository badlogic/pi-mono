import { getVips } from "./vips.js";

/**
 * Convert image to PNG format for terminal display.
 * Kitty graphics protocol requires PNG format (f=100).
 */
export async function convertToPng(
	base64Data: string,
	mimeType: string,
): Promise<{ data: string; mimeType: string } | null> {
	// Already PNG, no conversion needed
	if (mimeType === "image/png") {
		return { data: base64Data, mimeType };
	}

	const vips = await getVips();
	if (!vips) {
		// wasm-vips not available
		return null;
	}

	try {
		const buffer = Buffer.from(base64Data, "base64");
		const img = vips.Image.newFromBuffer(buffer);
		const pngBuffer = img.writeToBuffer(".png");
		img.delete();
		return {
			data: Buffer.from(pngBuffer).toString("base64"),
			mimeType: "image/png",
		};
	} catch {
		// Conversion failed
		return null;
	}
}
