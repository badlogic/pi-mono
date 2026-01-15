// Optional import - photon-node may not be available on all platforms (e.g., Termux)
let photon: any = null;
try {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	photon = require("@silvia-odwyer/photon-node");
} catch {
	// Photon not available - image conversion will be skipped
}

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

	// If photon is not available, cannot convert
	if (!photon) {
		return null;
	}

	try {
		const image = photon.PhotonImage.new_from_byteslice(new Uint8Array(Buffer.from(base64Data, "base64")));
		try {
			const pngBuffer = image.get_bytes();
			return {
				data: Buffer.from(pngBuffer).toString("base64"),
				mimeType: "image/png",
			};
		} finally {
			image.free();
		}
	} catch {
		// Conversion failed
		return null;
	}
}
