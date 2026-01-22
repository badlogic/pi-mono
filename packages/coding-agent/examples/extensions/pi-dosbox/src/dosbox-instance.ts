/**
 * Persistent DOSBox Instance Manager
 *
 * Manages a singleton DOSBox instance that runs in the background.
 * Provides API for sending keys, reading screen, and taking screenshots.
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import type { CommandInterface, Emulators } from "emulators";

const __dirname = dirname(fileURLToPath(import.meta.url));

let emulatorsInstance: Emulators | undefined;

async function getEmulators(): Promise<Emulators> {
	if (!emulatorsInstance) {
		const require = createRequire(import.meta.url);
		const distPath = dirname(require.resolve("emulators"));
		await import("emulators");
		const g = globalThis as unknown as { emulators: Emulators };
		const emu = g.emulators;
		emu.pathPrefix = `${distPath}/`;
		emu.pathSuffix = "";
		emulatorsInstance = emu;
	}
	return emulatorsInstance;
}

export interface DosboxState {
	width: number;
	height: number;
	lastFrame: Uint8Array | null;
	isGraphicsMode: boolean;
}

export class DosboxInstance {
	private static instance: DosboxInstance | null = null;

	private ci: CommandInterface | null = null;
	private state: DosboxState = {
		width: 0,
		height: 0,
		lastFrame: null,
		isGraphicsMode: false,
	};
	private frameListeners: Set<(rgba: Uint8Array, width: number, height: number) => void> = new Set();
	private initPromise: Promise<void> | null = null;
	private disposed = false;

	private constructor() {}

	static async getInstance(): Promise<DosboxInstance> {
		if (!DosboxInstance.instance) {
			DosboxInstance.instance = new DosboxInstance();
			await DosboxInstance.instance.init();
		}
		return DosboxInstance.instance;
	}

	static getInstanceSync(): DosboxInstance | null {
		return DosboxInstance.instance;
	}

	static async destroyInstance(): Promise<void> {
		if (DosboxInstance.instance) {
			await DosboxInstance.instance.dispose();
			DosboxInstance.instance = null;
		}
	}

	private async init(): Promise<void> {
		if (this.initPromise) return this.initPromise;

		this.initPromise = (async () => {
			const emu = await getEmulators();
			const bundle = await this.createBundle(emu);
			this.ci = await emu.dosboxDirect(bundle);

			// Mount QBasic files to C:
			await this.mountQBasic();

			const events = this.ci.events();

			events.onFrameSize((width: number, height: number) => {
				this.state.width = width;
				this.state.height = height;
			});

			events.onFrame((rgb: Uint8Array | null, rgba: Uint8Array | null) => {
				if (!this.state.width || !this.state.height) {
					if (this.ci) {
						this.state.width = this.ci.width();
						this.state.height = this.ci.height();
					}
				}

				const rgbaFrame = rgba ?? (rgb ? this.expandRgbToRgba(rgb) : null);
				if (rgbaFrame) {
					this.state.lastFrame = rgbaFrame;
					// Detect graphics mode by checking if we're in standard text resolution
					// Text mode is typically 640x400 or 720x400
					this.state.isGraphicsMode = this.state.width !== 640 && this.state.width !== 720;

					for (const listener of this.frameListeners) {
						listener(rgbaFrame, this.state.width, this.state.height);
					}
				}
			});

			events.onExit(() => {
				this.disposed = true;
				DosboxInstance.instance = null;
			});
		})();

		return this.initPromise;
	}

	private async createBundle(emu: Emulators): Promise<Uint8Array> {
		const bundle = await emu.bundle();
		bundle.autoexec(
			"@echo off",
			"mount c c:",
			"c:",
			"cls",
			"echo QuickBASIC 4.5 mounted at C:\\QB",
			"echo.",
			"dir /w",
		);
		return bundle.toUint8Array(true);
	}

	private async mountQBasic(): Promise<void> {
		if (!this.ci) return;

		const fs = (this.ci as unknown as { transport: { module: { FS: EmscriptenFS } } }).transport.module.FS;
		const rescan = (this.ci as unknown as { transport: { module: { _rescanFilesystem: () => void } } }).transport
			.module._rescanFilesystem;

		// Create directory structure
		try {
			fs.mkdir("/c");
		} catch {
			/* exists */
		}
		try {
			fs.mkdir("/c/QB");
		} catch {
			/* exists */
		}

		// Read QBasic files from the extension directory
		const qbasicDir = join(__dirname, "..", "qbasic");
		const { readdirSync, readFileSync } = await import("node:fs");

		const files = readdirSync(qbasicDir);
		for (const file of files) {
			if (file.startsWith(".")) continue;
			try {
				const data = readFileSync(join(qbasicDir, file));
				fs.writeFile(`/c/QB/${file.toUpperCase()}`, data);
			} catch (e) {
				console.error(`Failed to mount ${file}:`, e);
			}
		}

		// Rescan so DOS sees the new files
		rescan();
	}

	private expandRgbToRgba(rgb: Uint8Array): Uint8Array {
		const rgba = new Uint8Array((rgb.length / 3) * 4);
		for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
			rgba[j] = rgb[i] ?? 0;
			rgba[j + 1] = rgb[i + 1] ?? 0;
			rgba[j + 2] = rgb[i + 2] ?? 0;
			rgba[j + 3] = 255;
		}
		return rgba;
	}

	isReady(): boolean {
		return this.ci !== null && !this.disposed;
	}

	getState(): DosboxState {
		return { ...this.state };
	}

	getCommandInterface(): CommandInterface | null {
		return this.ci;
	}

	addFrameListener(listener: (rgba: Uint8Array, width: number, height: number) => void): void {
		this.frameListeners.add(listener);
	}

	removeFrameListener(listener: (rgba: Uint8Array, width: number, height: number) => void): void {
		this.frameListeners.delete(listener);
	}

	/**
	 * Send key events to DOSBox
	 */
	sendKeys(keys: string): void {
		if (!this.ci) return;

		for (const key of keys) {
			const keyCode = this.charToKeyCode(key);
			if (keyCode !== null) {
				const needsShift = this.needsShift(key);
				if (needsShift) {
					this.ci.sendKeyEvent(KBD.leftshift, true);
				}
				this.ci.sendKeyEvent(keyCode, true);
				this.ci.sendKeyEvent(keyCode, false);
				if (needsShift) {
					this.ci.sendKeyEvent(KBD.leftshift, false);
				}
			}
		}
	}

	/**
	 * Send a special key (enter, backspace, etc.)
	 */
	sendSpecialKey(key: "enter" | "backspace" | "tab" | "escape" | "up" | "down" | "left" | "right" | "f5"): void {
		if (!this.ci) return;

		const keyCode = KBD[key];
		if (keyCode) {
			this.ci.sendKeyEvent(keyCode, true);
			this.ci.sendKeyEvent(keyCode, false);
		}
	}

	/**
	 * Read text-mode screen content
	 */
	readScreenText(): string | null {
		if (!this.ci) return null;

		try {
			// Try to get screen text from emulators API
			const text = (this.ci as unknown as { screenText?: () => string }).screenText?.();
			return text ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Get screenshot as PNG base64
	 */
	getScreenshot(): { base64: string; width: number; height: number } | null {
		if (!this.state.lastFrame || !this.state.width || !this.state.height) {
			return null;
		}

		const png = this.encodePng(this.state.width, this.state.height, this.state.lastFrame);
		return {
			base64: png.toString("base64"),
			width: this.state.width,
			height: this.state.height,
		};
	}

	private encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
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
		const ihdr = this.createChunk("IHDR", header);
		const idat = this.createChunk("IDAT", compressed);
		const iend = this.createChunk("IEND", Buffer.alloc(0));

		return Buffer.concat([signature, ihdr, idat, iend]);
	}

	private createChunk(type: string, data: Buffer): Buffer {
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length, 0);
		const typeBuffer = Buffer.from(type, "ascii");
		const crcBuffer = Buffer.concat([typeBuffer, data]);
		const crc = this.crc32(crcBuffer);
		const crcOut = Buffer.alloc(4);
		crcOut.writeUInt32BE(crc, 0);
		return Buffer.concat([length, typeBuffer, data, crcOut]);
	}

	private crc32(buffer: Buffer): number {
		let crc = 0xffffffff;
		for (const byte of buffer) {
			crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
		}
		return (crc ^ 0xffffffff) >>> 0;
	}

	private charToKeyCode(char: string): number | null {
		const lower = char.toLowerCase();
		if (lower >= "a" && lower <= "z") {
			return lower.charCodeAt(0) - 32; // A-Z = 65-90
		}
		if (char >= "0" && char <= "9") {
			return char.charCodeAt(0); // 0-9 = 48-57
		}
		if (char === " ") return KBD.space;
		if (char === "\n" || char === "\r") return KBD.enter;
		if (char === "\t") return KBD.tab;
		// Common punctuation
		const punct: Record<string, number> = {
			".": 46,
			",": 44,
			";": 59,
			":": 59, // shift
			"'": 39,
			'"': 39, // shift
			"-": 45,
			_: 45, // shift
			"=": 61,
			"+": 61, // shift
			"[": 91,
			"]": 93,
			"\\": 92,
			"/": 47,
			"!": 49, // shift+1
			"@": 50, // shift+2
			"#": 51, // shift+3
			$: 52, // shift+4
			"%": 53, // shift+5
			"^": 54, // shift+6
			"&": 55, // shift+7
			"*": 56, // shift+8
			"(": 57, // shift+9
			")": 48, // shift+0
		};
		return punct[char] ?? null;
	}

	private needsShift(char: string): boolean {
		if (char >= "A" && char <= "Z") return true;
		return '~!@#$%^&*()_+{}|:"<>?'.includes(char);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.frameListeners.clear();

		if (this.ci) {
			const origLog = console.log;
			const origError = console.error;
			console.log = () => {};
			console.error = () => {};
			try {
				await this.ci.exit();
			} catch {
				/* ignore */
			}
			setTimeout(() => {
				console.log = origLog;
				console.error = origError;
			}, 100);
			this.ci = null;
		}
	}
}

// js-dos key codes
const KBD: Record<string, number> = {
	enter: 257,
	backspace: 259,
	tab: 258,
	escape: 256,
	space: 32,
	leftshift: 340,
	up: 265,
	down: 264,
	left: 263,
	right: 262,
	f5: 294,
};

const CRC_TABLE = createCrcTable();

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

// Emscripten FS type
interface EmscriptenFS {
	mkdir(path: string): void;
	writeFile(path: string, data: Uint8Array | Buffer): void;
	readFile(path: string): Uint8Array;
	readdir(path: string): string[];
	unlink(path: string): void;
}
