// Use ESM entry point so Bun can embed the WASM in compiled binaries
// (the CJS entry uses fs.readFileSync which breaks in standalone binaries)
import { PhotonImage } from "@silvia-odwyer/photon-node/photon_rs_bg.js";

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
		const image = PhotonImage.new_from_byteslice(new Uint8Array(Buffer.from(base64Data, "base64")));
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
