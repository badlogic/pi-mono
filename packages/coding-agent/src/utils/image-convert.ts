import { loadPhoton } from "./photon.js";

/**
 * Convert image to PNG format for terminal display.
 * Kitty graphics protocol requires PNG format (f=100).
 */
export async function convertToPng(base64Data: string, mimeType: string): Promise<{ data: string; mimeType: string }> {
	// Already PNG, no conversion needed
	if (mimeType === "image/png") {
		return { data: base64Data, mimeType };
	}

	const photon = await loadPhoton();
	if (!photon) {
		throw new Error("Photon module not available");
	}

	try {
		const bytes = new Uint8Array(Buffer.from(base64Data, "base64"));
		const image = photon.PhotonImage.new_from_byteslice(bytes);
		try {
			const pngBuffer = image.get_bytes();
			return {
				data: Buffer.from(pngBuffer).toString("base64"),
				mimeType: "image/png",
			};
		} finally {
			image.free();
		}
	} catch (e) {
		// Conversion failed - return error details
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(`Photon conversion failed: ${msg}`);
	}
}
