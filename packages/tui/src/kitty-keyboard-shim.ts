import { createRequire } from "node:module";
import { setKittyProtocolActive } from "./keys.js";
import { StdinBuffer } from "./stdin-buffer.js";

type InputMode = "legacy-vt" | "kitty-native" | "win32-translate";

const WINDOWS_KITTY_PROBE_TIMEOUT_MS = 500;
const WINDOWS_PROBE_RESPONSE_SUPPRESS_MS = 500;

const requireModule = createRequire(import.meta.url);

const STD_INPUT_HANDLE = -10;
const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;

const KITTY_CSI_U_SEQUENCE = /^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/;

export interface KittyKeyboardShimOptions {
	windowsKittyProbeTimeoutMs?: number;
	windowsProbeResponseSuppressMs?: number;
	windowsPreferKittyNative?: boolean;
}

/**
 * Keyboard normalization contract:
 *
 * - Goal: expose a single VT/Kitty-compatible input stream to the TUI key parser.
 * - Bracketed paste is preserved unchanged (`\x1b[200~...\x1b[201~`).
 * - Unix/macOS/Linux: request Kitty mode (`CSI > 7 u`) optimistically; if the terminal
 *   ignores it, legacy VT input continues to flow unchanged.
 * - Windows: enable `ENABLE_VIRTUAL_TERMINAL_INPUT`, probe Kitty support (`CSI ? u` + DA1),
 *   and fall back to win32-input-mode (`CSI ? 9001 h`) when Kitty is unavailable.
 * - In win32 fallback mode, `CSI ... _` records are translated to Kitty/VT-compatible key
 *   sequences so higher layers do not need Windows-specific key handling.
 * - `setKittyProtocolActive(true)` is only asserted when native Kitty input is confirmed,
 *   preserving legacy parsing behavior on terminals that ignore Kitty enable requests.
 */
export class KittyKeyboardShim {
	private onDataHandler?: (sequence: string) => void;
	private stdinBuffer?: StdinBuffer;
	private stdinDataHandler?: (data: string) => void;

	private inputMode: InputMode = "legacy-vt";
	private kittyNativeActive = false;
	private kittyModeRequested = false;
	private win32InputModeActive = false;

	private windowsKittyProbeActive = false;
	private windowsKittyProbeTimer: ReturnType<typeof setTimeout> | undefined;
	private windowsProbeResponseDeadline = 0;
	private pendingProbeSequences: string[] = [];
	private readonly windowsKittyProbeTimeoutMs: number;
	private readonly windowsProbeResponseSuppressMs: number;
	private readonly windowsPreferKittyNative: boolean;

	constructor(
		private readonly stdin: NodeJS.ReadStream,
		private readonly stdout: NodeJS.WriteStream,
		private readonly platform: NodeJS.Platform = process.platform,
		options: KittyKeyboardShimOptions = {},
	) {
		this.windowsKittyProbeTimeoutMs = options.windowsKittyProbeTimeoutMs ?? WINDOWS_KITTY_PROBE_TIMEOUT_MS;
		this.windowsProbeResponseSuppressMs =
			options.windowsProbeResponseSuppressMs ?? WINDOWS_PROBE_RESPONSE_SUPPRESS_MS;
		this.windowsPreferKittyNative = options.windowsPreferKittyNative ?? false;
	}

	get kittyNative(): boolean {
		return this.kittyNativeActive;
	}

	start(onData: (sequence: string) => void): void {
		this.onDataHandler = onData;

		if (this.platform === "win32") {
			this.enableWindowsVTInput();
		}

		this.setupStdinBuffer();
		this.stdin.on("data", this.stdinDataHandler!);

		if (this.platform !== "win32") {
			this.enableKittyNativeMode(false);
			return;
		}

		// Default to win32 input mode translation on Windows for reliable modified
		// Enter/Tab handling (e.g. Shift+Enter), even when Kitty probing is ambiguous.
		if (!this.windowsPreferKittyNative) {
			this.enableWindowsInputModeFallback();
			return;
		}

		this.startWindowsKittyProbe();
	}

	async drainInput(maxMs = 1000, idleMs = 50): Promise<void> {
		this.disableKeyboardModes();

		const previousHandler = this.onDataHandler;
		this.onDataHandler = undefined;

		let lastDataTime = Date.now();
		const onData = () => {
			lastDataTime = Date.now();
		};

		this.stdin.on("data", onData);
		const endTime = Date.now() + maxMs;

		try {
			while (true) {
				const now = Date.now();
				const timeLeft = endTime - now;
				if (timeLeft <= 0) break;
				if (now - lastDataTime >= idleMs) break;
				await new Promise((resolve) => setTimeout(resolve, Math.min(idleMs, timeLeft)));
			}
		} finally {
			this.stdin.removeListener("data", onData);
			this.onDataHandler = previousHandler;
		}
	}

	stop(): void {
		this.disableKeyboardModes();

		if (this.stdinBuffer) {
			this.stdinBuffer.destroy();
			this.stdinBuffer = undefined;
		}

		if (this.stdinDataHandler) {
			this.stdin.removeListener("data", this.stdinDataHandler);
			this.stdinDataHandler = undefined;
		}

		this.onDataHandler = undefined;
	}

	private setupStdinBuffer(): void {
		this.stdinBuffer = new StdinBuffer({ timeout: 10 });

		this.stdinBuffer.on("data", (sequence) => {
			if (this.consumeWindowsKittyProbeResponse(sequence)) {
				return;
			}

			if (this.windowsKittyProbeActive) {
				this.pendingProbeSequences.push(sequence);
				return;
			}

			this.forwardSequenceToConsumer(sequence);
		});

		this.stdinBuffer.on("paste", (content) => {
			const pasteSequence = `\x1b[200~${content}\x1b[201~`;
			if (this.windowsKittyProbeActive) {
				this.pendingProbeSequences.push(pasteSequence);
				return;
			}
			this.forwardSequenceToConsumer(pasteSequence);
		});

		this.stdinDataHandler = (data: string) => {
			this.stdinBuffer!.process(data);
		};
	}

	private forwardSequenceToConsumer(sequence: string): void {
		if (!this.onDataHandler) return;

		const translated = this.inputMode === "win32-translate" ? translateWin32InputModeToKitty(sequence) : sequence;
		if (translated.length === 0) return;

		if (this.inputMode === "kitty-native" && !this.kittyNativeActive && KITTY_CSI_U_SEQUENCE.test(translated)) {
			this.setKittyNativeActive(true);
		}

		this.onDataHandler(translated);
	}

	private setKittyNativeActive(active: boolean): void {
		this.kittyNativeActive = active;
		setKittyProtocolActive(active);
	}

	private enableKittyNativeMode(assumeActive: boolean): void {
		if (this.kittyModeRequested) return;

		this.kittyModeRequested = true;
		this.inputMode = "kitty-native";
		this.setKittyNativeActive(assumeActive);
		this.stdout.write("\x1b[>7u");
	}

	private startWindowsKittyProbe(): void {
		this.windowsKittyProbeActive = true;
		this.windowsProbeResponseDeadline =
			Date.now() + this.windowsKittyProbeTimeoutMs + this.windowsProbeResponseSuppressMs;
		this.windowsKittyProbeTimer = setTimeout(() => {
			this.finishWindowsKeyboardNegotiation(false);
		}, this.windowsKittyProbeTimeoutMs);
		this.stdout.write("\x1b[?u\x1b[c");
	}

	private consumeWindowsKittyProbeResponse(sequence: string): boolean {
		if (this.platform !== "win32") return false;

		const isKittyResponse = /^\x1b\[\?\d+(?:;\d+)*u$/.test(sequence);
		const isPotentialKittyResponse = /^\x1b\[\?[\d;]*u$/.test(sequence);
		const isDa1Response = /^\x1b\[\?[\d;]*c$/.test(sequence);
		if (!isPotentialKittyResponse && !isDa1Response) {
			return false;
		}

		if (this.windowsKittyProbeActive) {
			if (isKittyResponse) {
				this.finishWindowsKeyboardNegotiation(true);
			}
			// During probe, consume Kitty/DA1 probe responses so they don't leak as input.
			return true;
		}

		// After probe completion, suppress any trailing probe responses briefly.
		return Date.now() <= this.windowsProbeResponseDeadline;
	}

	private finishWindowsKeyboardNegotiation(kittySupported: boolean): void {
		if (!this.windowsKittyProbeActive) return;
		this.windowsKittyProbeActive = false;
		this.windowsProbeResponseDeadline = Date.now() + this.windowsProbeResponseSuppressMs;

		if (this.windowsKittyProbeTimer) {
			clearTimeout(this.windowsKittyProbeTimer);
			this.windowsKittyProbeTimer = undefined;
		}

		if (kittySupported) {
			this.enableKittyNativeMode(true);
		} else {
			this.enableWindowsInputModeFallback();
		}

		if (this.pendingProbeSequences.length > 0) {
			const pending = this.pendingProbeSequences;
			this.pendingProbeSequences = [];
			for (const sequence of pending) {
				this.forwardSequenceToConsumer(sequence);
			}
		}
	}

	private enableWindowsInputModeFallback(): void {
		if (this.win32InputModeActive) return;

		this.inputMode = "win32-translate";
		this.setKittyNativeActive(false);
		this.win32InputModeActive = true;
		this.stdout.write("\x1b[?9001h");
	}

	private disableKeyboardModes(): void {
		if (this.windowsKittyProbeTimer) {
			clearTimeout(this.windowsKittyProbeTimer);
			this.windowsKittyProbeTimer = undefined;
		}
		this.windowsKittyProbeActive = false;
		this.windowsProbeResponseDeadline = 0;
		this.pendingProbeSequences = [];

		if (this.kittyModeRequested) {
			this.stdout.write("\x1b[<u");
			this.kittyModeRequested = false;
		}

		if (this.win32InputModeActive) {
			this.stdout.write("\x1b[?9001l");
			this.win32InputModeActive = false;
		}

		this.setKittyNativeActive(false);
		this.inputMode = "legacy-vt";
	}

	/**
	 * On Windows, add ENABLE_VIRTUAL_TERMINAL_INPUT (0x0200) to the stdin
	 * console handle so the terminal sends VT sequences for modified keys
	 * (e.g. \x1b[Z for Shift+Tab).
	 */
	private enableWindowsVTInput(): void {
		try {
			// Use createRequire() for ESM compatibility when loading koffi.
			const koffi = requireModule("koffi");
			const k32 = koffi.load("kernel32.dll");
			const GetStdHandle = k32.func("void* __stdcall GetStdHandle(int)");
			const GetConsoleMode = k32.func("bool __stdcall GetConsoleMode(void*, _Out_ uint32_t*)");
			const SetConsoleMode = k32.func("bool __stdcall SetConsoleMode(void*, uint32_t)");

			const handle = GetStdHandle(STD_INPUT_HANDLE);
			const mode = new Uint32Array(1);
			const gotMode = GetConsoleMode(handle, mode);
			if (!gotMode) return;
			SetConsoleMode(handle, mode[0]! | ENABLE_VIRTUAL_TERMINAL_INPUT);
		} catch {
			// koffi not available — key modifier reporting will remain limited.
		}
	}
}

const WIN32_INPUT_MODE_PATTERN = /^\x1b\[(\d+);(\d+);(\d+);([01]);(\d+)(?:;(\d+))?_$/;

const CONTROL_KEY_STATE = {
	RIGHT_ALT_PRESSED: 0x0001,
	LEFT_ALT_PRESSED: 0x0002,
	RIGHT_CTRL_PRESSED: 0x0004,
	LEFT_CTRL_PRESSED: 0x0008,
	SHIFT_PRESSED: 0x0010,
} as const;

const VK = {
	backspace: 0x08,
	tab: 0x09,
	enter: 0x0d,
	escape: 0x1b,
	space: 0x20,
	pageUp: 0x21,
	pageDown: 0x22,
	end: 0x23,
	home: 0x24,
	left: 0x25,
	up: 0x26,
	right: 0x27,
	down: 0x28,
	insert: 0x2d,
	delete: 0x2e,
	f1: 0x70,
	f2: 0x71,
	f3: 0x72,
	f4: 0x73,
	f5: 0x74,
	f6: 0x75,
	f7: 0x76,
	f8: 0x77,
	f9: 0x78,
	f10: 0x79,
	f11: 0x7a,
	f12: 0x7b,
	oem1: 0xba,
	oemPlus: 0xbb,
	oemComma: 0xbc,
	oemMinus: 0xbd,
	oemPeriod: 0xbe,
	oem2: 0xbf,
	oem3: 0xc0,
	oem4: 0xdb,
	oem5: 0xdc,
	oem6: 0xdd,
	oem7: 0xde,
} as const;

const OEM_VK_CODEPOINTS: Record<number, number> = {
	[VK.oem1]: 59,
	[VK.oemPlus]: 61,
	[VK.oemComma]: 44,
	[VK.oemMinus]: 45,
	[VK.oemPeriod]: 46,
	[VK.oem2]: 47,
	[VK.oem3]: 96,
	[VK.oem4]: 91,
	[VK.oem5]: 92,
	[VK.oem6]: 93,
	[VK.oem7]: 39,
};

const FUNCTION_KEY_SEQUENCES: Record<number, string> = {
	[VK.f1]: "\x1bOP",
	[VK.f2]: "\x1bOQ",
	[VK.f3]: "\x1bOR",
	[VK.f4]: "\x1bOS",
	[VK.f5]: "\x1b[15~",
	[VK.f6]: "\x1b[17~",
	[VK.f7]: "\x1b[18~",
	[VK.f8]: "\x1b[19~",
	[VK.f9]: "\x1b[20~",
	[VK.f10]: "\x1b[21~",
	[VK.f11]: "\x1b[23~",
	[VK.f12]: "\x1b[24~",
};

interface Win32InputModeEvent {
	virtualKey: number;
	unicodeChar: number;
	keyDown: boolean;
	controlKeyState: number;
}

function parseWin32InputModeSequence(sequence: string): Win32InputModeEvent | null {
	const match = sequence.match(WIN32_INPUT_MODE_PATTERN);
	if (!match) return null;

	return {
		virtualKey: parseInt(match[1]!, 10),
		unicodeChar: parseInt(match[3]!, 10),
		keyDown: match[4] === "1",
		controlKeyState: parseInt(match[5]!, 10),
	};
}

function toKittyModifier(controlKeyState: number): number {
	const shift = (controlKeyState & CONTROL_KEY_STATE.SHIFT_PRESSED) !== 0;
	const alt =
		(controlKeyState & CONTROL_KEY_STATE.LEFT_ALT_PRESSED) !== 0 ||
		(controlKeyState & CONTROL_KEY_STATE.RIGHT_ALT_PRESSED) !== 0;
	const ctrl =
		(controlKeyState & CONTROL_KEY_STATE.LEFT_CTRL_PRESSED) !== 0 ||
		(controlKeyState & CONTROL_KEY_STATE.RIGHT_CTRL_PRESSED) !== 0;

	let modifier = 1;
	if (shift) modifier += 1;
	if (alt) modifier += 2;
	if (ctrl) modifier += 4;
	return modifier;
}

function isTextCodepoint(codepoint: number): boolean {
	if (codepoint <= 0 || codepoint === 0x7f) return false;
	const char = String.fromCodePoint(codepoint);
	// Exclude Unicode "Other" categories (controls, format, surrogate,
	// private-use, unassigned). Keep visible/printable text only.
	return !/\p{C}/u.test(char);
}

function isLikelyAltGrTextInput(event: Win32InputModeEvent): boolean {
	const hasRightAlt = (event.controlKeyState & CONTROL_KEY_STATE.RIGHT_ALT_PRESSED) !== 0;
	const hasLeftAlt = (event.controlKeyState & CONTROL_KEY_STATE.LEFT_ALT_PRESSED) !== 0;
	const hasLeftCtrl = (event.controlKeyState & CONTROL_KEY_STATE.LEFT_CTRL_PRESSED) !== 0;
	const hasRightCtrl = (event.controlKeyState & CONTROL_KEY_STATE.RIGHT_CTRL_PRESSED) !== 0;
	const textUnicode = isTextCodepoint(event.unicodeChar);

	// On Windows, AltGr usually appears as RightAlt + LeftCtrl.
	// Treat text-producing AltGr input as plain text, not Ctrl+Alt shortcut input.
	return hasRightAlt && !hasLeftAlt && hasLeftCtrl && !hasRightCtrl && textUnicode;
}

function printableCodepointFromVirtualKey(virtualKey: number): number | undefined {
	if (virtualKey >= 0x41 && virtualKey <= 0x5a) {
		return virtualKey + 32;
	}
	if (virtualKey >= 0x30 && virtualKey <= 0x39) {
		return virtualKey;
	}
	if (virtualKey >= 0x60 && virtualKey <= 0x69) {
		return virtualKey - 0x30;
	}
	return OEM_VK_CODEPOINTS[virtualKey];
}

function buildEventSuffix(eventType: 1 | 3): string {
	return eventType === 1 ? "" : `:${eventType}`;
}

function translateVirtualKeySequence(virtualKey: number, modifier: number, eventType: 1 | 3): string | undefined {
	const eventSuffix = buildEventSuffix(eventType);

	switch (virtualKey) {
		case VK.up:
			return `\x1b[1;${modifier}${eventSuffix}A`;
		case VK.down:
			return `\x1b[1;${modifier}${eventSuffix}B`;
		case VK.right:
			return `\x1b[1;${modifier}${eventSuffix}C`;
		case VK.left:
			return `\x1b[1;${modifier}${eventSuffix}D`;
		case VK.insert:
			return `\x1b[2;${modifier}${eventSuffix}~`;
		case VK.delete:
			return `\x1b[3;${modifier}${eventSuffix}~`;
		case VK.pageUp:
			return `\x1b[5;${modifier}${eventSuffix}~`;
		case VK.pageDown:
			return `\x1b[6;${modifier}${eventSuffix}~`;
		case VK.home:
			return `\x1b[7;${modifier}${eventSuffix}~`;
		case VK.end:
			return `\x1b[8;${modifier}${eventSuffix}~`;
	}

	if (eventType === 1 && modifier === 1) {
		return FUNCTION_KEY_SEQUENCES[virtualKey];
	}

	return undefined;
}

function resolveCodepoint(event: Win32InputModeEvent): number | undefined {
	switch (event.virtualKey) {
		case VK.backspace:
			return 127;
		case VK.tab:
			return 9;
		case VK.enter:
			return 13;
		case VK.escape:
			return 27;
		case VK.space:
			return 32;
	}

	if (isTextCodepoint(event.unicodeChar)) {
		return event.unicodeChar;
	}
	if (event.unicodeChar === 127) {
		return 127;
	}

	const printableFromVirtualKey = printableCodepointFromVirtualKey(event.virtualKey);
	if (printableFromVirtualKey !== undefined) {
		return printableFromVirtualKey;
	}

	if (event.unicodeChar > 0) {
		return event.unicodeChar;
	}

	return undefined;
}

function translateWin32InputModeToKitty(sequence: string): string {
	const parsed = parseWin32InputModeSequence(sequence);
	if (!parsed) return sequence;

	const modifier = toKittyModifier(parsed.controlKeyState);
	const eventType: 1 | 3 = parsed.keyDown ? 1 : 3;

	const translatedSequence = translateVirtualKeySequence(parsed.virtualKey, modifier, eventType);
	if (translatedSequence !== undefined) {
		return translatedSequence;
	}

	const codepoint = resolveCodepoint(parsed);
	if (codepoint === undefined) {
		return "";
	}

	const modifierBits = modifier - 1;
	const hasAlt = (modifierBits & 2) !== 0;
	const hasCtrl = (modifierBits & 4) !== 0;
	const isPrintable = isTextCodepoint(codepoint);
	const isAltGrTextInput = isLikelyAltGrTextInput(parsed);

	// Keep key-down text input as plain text so components like Input continue to
	// work without requiring CSI-u decoding for printable characters.
	// Emit key-up as CSI-u so components opting into release events still work.
	if (isPrintable && ((!hasAlt && !hasCtrl) || isAltGrTextInput)) {
		if (eventType === 3) {
			const releaseModifier = isAltGrTextInput ? 1 : modifier;
			return `\x1b[${codepoint};${releaseModifier}:3u`;
		}
		return String.fromCodePoint(codepoint);
	}

	const eventSuffix = buildEventSuffix(eventType);
	return `\x1b[${codepoint};${modifier}${eventSuffix}u`;
}
