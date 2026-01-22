/**
 * DOSBox TUI Component
 *
 * Renders DOSBox framebuffer as an image in the terminal.
 */

import { createRequire } from "node:module";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";
import type { Component } from "@mariozechner/pi-tui";
import {
	allocateImageId,
	deleteKittyImage,
	Image,
	type ImageTheme,
	isKeyRelease,
	Key,
	matchesKey,
	truncateToWidth,
} from "@mariozechner/pi-tui";
import type { CommandInterface, Emulators } from "emulators";

const MAX_WIDTH_CELLS = 120;

let emulatorsInstance: Emulators | undefined;

async function getEmulators(): Promise<Emulators> {
	if (!emulatorsInstance) {
		const require = createRequire(import.meta.url);
		const distPath = dirname(require.resolve("emulators"));
		// The emulators package assigns to global.emulators, not module.exports
		await import("emulators");
		const g = globalThis as unknown as { emulators: Emulators };
		const emu = g.emulators;
		emu.pathPrefix = `${distPath}/`;
		emu.pathSuffix = "";
		emulatorsInstance = emu;
	}
	return emulatorsInstance;
}

export class DosboxComponent implements Component {
	private tui: { requestRender: () => void };
	private onClose: () => void;
	private ci: CommandInterface | null = null;
	private image: Image | null = null;
	private imageTheme: ImageTheme;
	private frameWidth = 0;
	private frameHeight = 0;
	private loadingMessage = "Loading DOSBox...";
	private errorMessage: string | null = null;
	private cachedLines: string[] = [];
	private cachedWidth = 0;
	private cachedVersion = -1;
	private version = 0;
	private disposed = false;
	private bundleData?: Uint8Array;
	private kittyPushed = false;
	private imageId: number;

	wantsKeyRelease = true;

	constructor(
		tui: { requestRender: () => void },
		fallbackColor: (s: string) => string,
		onClose: () => void,
		bundleData?: Uint8Array,
	) {
		this.tui = tui;
		this.onClose = onClose;
		this.bundleData = bundleData;
		this.imageTheme = { fallbackColor };
		this.imageId = allocateImageId();
		void this.init();
	}

	private async init(): Promise<void> {
		try {
			const emu = await getEmulators();
			const initData = this.bundleData ?? (await this.createDefaultBundle(emu));
			this.ci = await emu.dosboxDirect(initData);

			const events = this.ci.events();
			events.onFrameSize((width: number, height: number) => {
				this.frameWidth = width;
				this.frameHeight = height;
				this.version++;
				this.tui.requestRender();
			});
			events.onFrame((rgb: Uint8Array | null, rgba: Uint8Array | null) => {
				this.updateFrame(rgb, rgba);
			});
			events.onExit(() => {
				this.dispose();
				this.onClose();
			});

			// Push Kitty enhanced mode for proper key press/release
			process.stdout.write("\x1b[>15u");
			this.kittyPushed = true;
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
			this.tui.requestRender();
		}
	}

	private async createDefaultBundle(emu: Emulators): Promise<Uint8Array> {
		const bundle = await emu.bundle();
		bundle.autoexec(
			"@echo off",
			"cls",
			"echo pi DOSBox",
			"echo.",
			"echo Pass a .jsdos bundle to run a game",
			"echo.",
			"dir",
		);
		return bundle.toUint8Array(true);
	}

	private updateFrame(rgb: Uint8Array | null, rgba: Uint8Array | null): void {
		if (!this.frameWidth || !this.frameHeight) {
			if (this.ci) {
				this.frameWidth = this.ci.width();
				this.frameHeight = this.ci.height();
			}
			if (!this.frameWidth || !this.frameHeight) return;
		}
		const rgbaFrame = rgba ?? (rgb ? expandRgbToRgba(rgb) : null);
		if (!rgbaFrame) return;

		const png = encodePng(this.frameWidth, this.frameHeight, rgbaFrame);
		const base64 = png.toString("base64");
		this.image = new Image(
			base64,
			"image/png",
			this.imageTheme,
			{ maxWidthCells: MAX_WIDTH_CELLS, imageId: this.imageId },
			{ widthPx: this.frameWidth, heightPx: this.frameHeight },
		);
		this.version++;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		const released = isKeyRelease(data);

		if (!released && matchesKey(data, Key.ctrl("q"))) {
			this.dispose();
			this.onClose();
			return;
		}

		if (!this.ci) return;

		const parsed = parseKeyWithModifiers(data);
		if (!parsed) return;

		const { keyCode, shift, ctrl, alt } = parsed;

		if (shift) this.ci.sendKeyEvent(KBD.leftshift, !released);
		if (ctrl) this.ci.sendKeyEvent(KBD.leftctrl, !released);
		if (alt) this.ci.sendKeyEvent(KBD.leftalt, !released);

		this.ci.sendKeyEvent(keyCode, !released);
	}

	invalidate(): void {
		this.cachedWidth = 0;
	}

	render(width: number): string[] {
		if (this.errorMessage) {
			return [truncateToWidth(`DOSBox error: ${this.errorMessage}`, width)];
		}
		if (!this.ci) {
			return [truncateToWidth(this.loadingMessage, width)];
		}
		if (!this.image) {
			return [truncateToWidth("Waiting for DOSBox frame...", width)];
		}
		if (width === this.cachedWidth && this.cachedVersion === this.version) {
			return this.cachedLines;
		}

		const imageLines = this.image.render(width);
		const footer = truncateToWidth("\x1b[2mCtrl+Q to quit\x1b[22m", width);
		const lines = [...imageLines, footer];

		this.cachedLines = lines;
		this.cachedWidth = width;
		this.cachedVersion = this.version;

		return lines;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;

		// Delete the terminal image
		process.stdout.write(deleteKittyImage(this.imageId));

		if (this.kittyPushed) {
			process.stdout.write("\x1b[<u");
			this.kittyPushed = false;
		}
		if (this.ci) {
			void this.ci.exit().catch(() => undefined);
			this.ci = null;
		}
	}
}

function expandRgbToRgba(rgb: Uint8Array): Uint8Array {
	const rgba = new Uint8Array((rgb.length / 3) * 4);
	for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
		rgba[j] = rgb[i] ?? 0;
		rgba[j + 1] = rgb[i + 1] ?? 0;
		rgba[j + 2] = rgb[i + 2] ?? 0;
		rgba[j + 3] = 255;
	}
	return rgba;
}

const CRC_TABLE = createCrcTable();

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		const rowOffset = y * (stride + 1);
		raw[rowOffset] = 0;
		raw.set(rgba.subarray(y * stride, y * stride + stride), rowOffset + 1);
	}

	const compressed = deflateSync(raw);

	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	header[10] = 0;
	header[11] = 0;
	header[12] = 0;

	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = createChunk("IHDR", header);
	const idat = createChunk("IDAT", compressed);
	const iend = createChunk("IEND", Buffer.alloc(0));

	return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const typeBuffer = Buffer.from(type, "ascii");
	const crcBuffer = Buffer.concat([typeBuffer, data]);
	const crc = crc32(crcBuffer);
	const crcOut = Buffer.alloc(4);
	crcOut.writeUInt32BE(crc, 0);
	return Buffer.concat([length, typeBuffer, data, crcOut]);
}

function crc32(buffer: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable(): Uint32Array {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let j = 0; j < 8; j++) {
			if (c & 1) {
				c = 0xedb88320 ^ (c >>> 1);
			} else {
				c >>>= 1;
			}
		}
		table[i] = c >>> 0;
	}
	return table;
}

// js-dos key codes (from js-dos/src/window/dos/controls/keys.ts)
const KBD = {
	enter: 257,
	backspace: 259,
	tab: 258,
	esc: 256,
	space: 32,
	leftshift: 340,
	rightshift: 344,
	leftctrl: 341,
	rightctrl: 345,
	leftalt: 342,
	rightalt: 346,
	up: 265,
	down: 264,
	left: 263,
	right: 262,
	home: 268,
	end: 269,
	pageup: 266,
	pagedown: 267,
	insert: 260,
	delete: 261,
	f1: 290,
	f2: 291,
	f3: 292,
	f4: 293,
	f5: 294,
	f6: 295,
	f7: 296,
	f8: 297,
	f9: 298,
	f10: 299,
	f11: 300,
	f12: 301,
};

interface ParsedKey {
	keyCode: number;
	shift: boolean;
	ctrl: boolean;
	alt: boolean;
}

function decodeModifiers(modifierField: number): { shift: boolean; ctrl: boolean; alt: boolean } {
	const modifiers = modifierField - 1;
	return {
		shift: (modifiers & 1) !== 0,
		alt: (modifiers & 2) !== 0,
		ctrl: (modifiers & 4) !== 0,
	};
}

function parseKeyWithModifiers(data: string): ParsedKey | null {
	// Kitty CSI u sequences: \x1b[codepoint(:shifted(:base))?;modifier(:event)?u
	if (data.startsWith("\x1b[") && data.endsWith("u")) {
		const body = data.slice(2, -1);
		const [keyPart, modifierPart] = body.split(";");
		if (keyPart) {
			const codepoint = parseInt(keyPart.split(":")[0], 10);
			if (!Number.isNaN(codepoint)) {
				const modifierField = modifierPart ? parseInt(modifierPart.split(":")[0], 10) : 1;
				const { shift, alt, ctrl } = decodeModifiers(Number.isNaN(modifierField) ? 1 : modifierField);
				const keyCode = codepointToJsDosKey(codepoint);
				if (keyCode !== null) {
					return { keyCode, shift, ctrl, alt };
				}
			}
		}
	}

	// CSI sequences: \x1b[<num>;<modifier>:<event><suffix>
	const csiMatch = data.match(/^\x1b\[(\d+);(\d+)(?::\d+)?([~A-Za-z])$/);
	if (csiMatch) {
		const code = parseInt(csiMatch[1], 10);
		const modifierField = parseInt(csiMatch[2], 10);
		const suffix = csiMatch[3];
		const { shift, alt, ctrl } = decodeModifiers(modifierField);
		const keyCode = mapCsiKeyToJsDos(code, suffix);
		if (keyCode === null) return null;
		return { keyCode, shift, ctrl, alt };
	}

	// Legacy/simple input
	const keyCode = mapKeyToJsDos(data);
	if (keyCode === null) return null;
	const shift = data.length === 1 && data >= "A" && data <= "Z";
	return { keyCode, shift, ctrl: false, alt: false };
}

function codepointToJsDosKey(codepoint: number): number | null {
	if (codepoint === 13) return KBD.enter;
	if (codepoint === 9) return KBD.tab;
	if (codepoint === 27) return KBD.esc;
	if (codepoint === 8 || codepoint === 127) return KBD.backspace;
	if (codepoint === 32) return KBD.space;
	if (codepoint >= 97 && codepoint <= 122) return codepoint - 32; // a-z -> A-Z
	if (codepoint >= 65 && codepoint <= 90) return codepoint; // A-Z
	if (codepoint >= 48 && codepoint <= 57) return codepoint; // 0-9
	return null;
}

function mapCsiKeyToJsDos(code: number, suffix: string): number | null {
	switch (suffix) {
		case "A":
			return KBD.up;
		case "B":
			return KBD.down;
		case "C":
			return KBD.right;
		case "D":
			return KBD.left;
		case "H":
			return KBD.home;
		case "F":
			return KBD.end;
		case "P":
			return KBD.f1;
		case "Q":
			return KBD.f2;
		case "R":
			return KBD.f3;
		case "S":
			return KBD.f4;
		case "Z":
			return KBD.tab;
		case "~":
			switch (code) {
				case 1:
				case 7:
					return KBD.home;
				case 2:
					return KBD.insert;
				case 3:
					return KBD.delete;
				case 4:
				case 8:
					return KBD.end;
				case 5:
					return KBD.pageup;
				case 6:
					return KBD.pagedown;
				case 11:
					return KBD.f1;
				case 12:
					return KBD.f2;
				case 13:
					return KBD.f3;
				case 14:
					return KBD.f4;
				case 15:
					return KBD.f5;
				case 17:
					return KBD.f6;
				case 18:
					return KBD.f7;
				case 19:
					return KBD.f8;
				case 20:
					return KBD.f9;
				case 21:
					return KBD.f10;
				case 23:
					return KBD.f11;
				case 24:
					return KBD.f12;
				default:
					return null;
			}
		default:
			return null;
	}
}

function mapKeyToJsDos(data: string): number | null {
	if (matchesKey(data, Key.enter)) return KBD.enter;
	if (matchesKey(data, Key.backspace)) return KBD.backspace;
	if (matchesKey(data, Key.tab)) return KBD.tab;
	if (matchesKey(data, Key.escape)) return KBD.esc;
	if (matchesKey(data, Key.space)) return KBD.space;
	if (matchesKey(data, Key.up)) return KBD.up;
	if (matchesKey(data, Key.down)) return KBD.down;
	if (matchesKey(data, Key.left)) return KBD.left;
	if (matchesKey(data, Key.right)) return KBD.right;
	if (matchesKey(data, Key.pageUp)) return KBD.pageup;
	if (matchesKey(data, Key.pageDown)) return KBD.pagedown;
	if (matchesKey(data, Key.home)) return KBD.home;
	if (matchesKey(data, Key.end)) return KBD.end;
	if (matchesKey(data, Key.insert)) return KBD.insert;
	if (matchesKey(data, Key.delete)) return KBD.delete;
	if (matchesKey(data, Key.f1)) return KBD.f1;
	if (matchesKey(data, Key.f2)) return KBD.f2;
	if (matchesKey(data, Key.f3)) return KBD.f3;
	if (matchesKey(data, Key.f4)) return KBD.f4;
	if (matchesKey(data, Key.f5)) return KBD.f5;
	if (matchesKey(data, Key.f6)) return KBD.f6;
	if (matchesKey(data, Key.f7)) return KBD.f7;
	if (matchesKey(data, Key.f8)) return KBD.f8;
	if (matchesKey(data, Key.f9)) return KBD.f9;
	if (matchesKey(data, Key.f10)) return KBD.f10;
	if (matchesKey(data, Key.f11)) return KBD.f11;
	if (matchesKey(data, Key.f12)) return KBD.f12;

	if (data.length === 1) {
		const code = data.charCodeAt(0);
		if (data >= "a" && data <= "z") return code - 32;
		if (data >= "A" && data <= "Z") return code;
		if (data >= "0" && data <= "9") return code;
	}
	return null;
}
