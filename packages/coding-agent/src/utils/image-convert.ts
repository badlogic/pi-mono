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

	try {
		const sharp = (await import("sharp")).default;
		const buffer = Buffer.from(base64Data, "base64");
		const pngBuffer = await sharp(buffer).png().toBuffer();
		return {
			data: pngBuffer.toString("base64"),
			mimeType: "image/png",
		};
	} catch {
		// Sharp not available or conversion failed
		return null;
	}
}
