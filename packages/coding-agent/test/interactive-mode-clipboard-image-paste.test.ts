import * as fs from "node:fs";

import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ClipboardImage } from "../src/utils/clipboard-image.js";

const mocks = vi.hoisted(() => {
	return {
		readClipboardImage: vi.fn<() => Promise<ClipboardImage | null>>(),
	};
});

vi.mock("../src/utils/clipboard-image.js", async () => {
	const actual = await vi.importActual<typeof import("../src/utils/clipboard-image.js")>(
		"../src/utils/clipboard-image.js",
	);
	return {
		...actual,
		readClipboardImage: mocks.readClipboardImage,
	};
});

function createTinyBmp1x1Red24bpp(): Buffer {
	// Minimal 1x1 24bpp BMP (BGR + row padding to 4 bytes)
	// File size = 14 (BMP header) + 40 (DIB header) + 4 (pixel row) = 58
	const buffer = Buffer.alloc(58);

	// BITMAPFILEHEADER
	buffer.write("BM", 0, "ascii");
	buffer.writeUInt32LE(buffer.length, 2); // file size
	buffer.writeUInt16LE(0, 6); // reserved1
	buffer.writeUInt16LE(0, 8); // reserved2
	buffer.writeUInt32LE(54, 10); // pixel data offset

	// BITMAPINFOHEADER
	buffer.writeUInt32LE(40, 14); // DIB header size
	buffer.writeInt32LE(1, 18); // width
	buffer.writeInt32LE(1, 22); // height (positive = bottom-up)
	buffer.writeUInt16LE(1, 26); // planes
	buffer.writeUInt16LE(24, 28); // bits per pixel
	buffer.writeUInt32LE(0, 30); // compression (BI_RGB)
	buffer.writeUInt32LE(4, 34); // image size (incl. padding)
	buffer.writeInt32LE(0, 38); // x pixels per meter
	buffer.writeInt32LE(0, 42); // y pixels per meter
	buffer.writeUInt32LE(0, 46); // colors used
	buffer.writeUInt32LE(0, 50); // important colors

	// Pixel data (B, G, R) + 1 byte padding
	buffer[54] = 0x00; // B
	buffer[55] = 0x00; // G
	buffer[56] = 0xff; // R
	buffer[57] = 0x00; // padding

	return buffer;
}

describe("InteractiveMode.handleClipboardImagePaste", () => {
	beforeEach(() => {
		vi.resetModules();
		mocks.readClipboardImage.mockReset();
	});

	test("converts image/bmp clipboard bytes to PNG when pasting", async () => {
		const bmpBytes = createTinyBmp1x1Red24bpp();
		mocks.readClipboardImage.mockResolvedValue({
			bytes: new Uint8Array(bmpBytes),
			mimeType: "image/bmp",
		});

		const { InteractiveMode } = await import("../src/modes/interactive/interactive-mode.js");

		let pastedPath: string | undefined;

		const fakeThis: any = {
			editor: {
				insertTextAtCursor: (text: string) => {
					pastedPath = text;
				},
			},
			ui: { requestRender: vi.fn() },
			showWarning: vi.fn(),
		};

		try {
			await (InteractiveMode as any).prototype.handleClipboardImagePaste.call(fakeThis);

			expect(fakeThis.showWarning).not.toHaveBeenCalled();
			expect(pastedPath).toBeTruthy();
			expect(pastedPath).toMatch(/\.png$/);

			const fileBytes = fs.readFileSync(pastedPath!);
			// PNG magic bytes: 89 50 4E 47
			expect(fileBytes[0]).toBe(0x89);
			expect(fileBytes[1]).toBe(0x50);
			expect(fileBytes[2]).toBe(0x4e);
			expect(fileBytes[3]).toBe(0x47);
		} finally {
			if (pastedPath && fs.existsSync(pastedPath)) {
				fs.unlinkSync(pastedPath);
			}
		}
	});
});
