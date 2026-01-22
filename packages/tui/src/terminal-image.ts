import { execSync } from "node:child_process";
import { KITTY_DIACRITICS } from "./diacritics.js";

export type ImageProtocol = "kitty" | "iterm2" | null;

export interface TerminalCapabilities {
	images: ImageProtocol;
	trueColor: boolean;
	hyperlinks: boolean;
}

export interface CellDimensions {
	widthPx: number;
	heightPx: number;
}

export interface ImageDimensions {
	widthPx: number;
	heightPx: number;
}

export interface ImageRenderOptions {
	maxWidthCells?: number;
	maxHeightCells?: number;
	preserveAspectRatio?: boolean;
}

let cachedCapabilities: TerminalCapabilities | null = null;

// Default cell dimensions - updated by TUI when terminal responds to query
let cellDimensions: CellDimensions = { widthPx: 9, heightPx: 18 };

export function getCellDimensions(): CellDimensions {
	return cellDimensions;
}

export function setCellDimensions(dims: CellDimensions): void {
	cellDimensions = dims;
}

export function detectCapabilities(): TerminalCapabilities {
	const termProgram = process.env.TERM_PROGRAM?.toLowerCase() || "";
	const term = process.env.TERM?.toLowerCase() || "";
	const colorTerm = process.env.COLORTERM?.toLowerCase() || "";

	if (process.env.KITTY_WINDOW_ID || termProgram === "kitty") {
		return { images: "kitty", trueColor: true, hyperlinks: true };
	}

	if (termProgram === "ghostty" || term.includes("ghostty") || process.env.GHOSTTY_RESOURCES_DIR) {
		return { images: "kitty", trueColor: true, hyperlinks: true };
	}

	if (process.env.WEZTERM_PANE || termProgram === "wezterm") {
		return { images: "kitty", trueColor: true, hyperlinks: true };
	}

	if (process.env.ITERM_SESSION_ID || termProgram === "iterm.app") {
		return { images: "iterm2", trueColor: true, hyperlinks: true };
	}

	if (termProgram === "vscode") {
		return { images: null, trueColor: true, hyperlinks: true };
	}

	if (termProgram === "alacritty") {
		return { images: null, trueColor: true, hyperlinks: true };
	}

	const trueColor = colorTerm === "truecolor" || colorTerm === "24bit";
	return { images: null, trueColor, hyperlinks: true };
}

export function getCapabilities(): TerminalCapabilities {
	if (!cachedCapabilities) {
		cachedCapabilities = detectCapabilities();
	}
	return cachedCapabilities;
}

export function resetCapabilitiesCache(): void {
	cachedCapabilities = null;
}

/**
 * Check if we're running inside tmux.
 */
export function isInsideTmux(): boolean {
	return !!process.env.TMUX;
}

/**
 * Cache for tmux passthrough check.
 * null = not checked yet, true/false = cached result
 */
let tmuxPassthroughEnabled: boolean | null = null;

/**
 * Check if tmux has allow-passthrough enabled.
 * This is required for images to work in tmux.
 * Result is cached after first check.
 */
export function isTmuxPassthroughEnabled(): boolean {
	if (!isInsideTmux()) {
		return false;
	}

	if (tmuxPassthroughEnabled !== null) {
		return tmuxPassthroughEnabled;
	}

	try {
		const result = execSync("tmux show-options -gv allow-passthrough 2>/dev/null", {
			encoding: "utf-8",
			timeout: 1000,
		}).trim();
		// allow-passthrough can be "on", "all", or "off"
		// "on" allows passthrough only for visible panes
		// "all" allows passthrough for all panes including invisible ones
		// Both "on" and "all" work for our purposes
		tmuxPassthroughEnabled = result === "on" || result === "all";
	} catch {
		// If tmux command fails, assume passthrough is not enabled
		tmuxPassthroughEnabled = false;
	}

	return tmuxPassthroughEnabled;
}

/**
 * Reset the tmux passthrough cache.
 * Useful for testing or when tmux config might have changed.
 */
export function resetTmuxPassthroughCache(): void {
	tmuxPassthroughEnabled = null;
}

/**
 * Wrap a sequence in tmux passthrough escapes.
 * Inside tmux, escape sequences need to be wrapped so they pass through to the outer terminal.
 * Format: \x1bPtmux;<escaped_sequence>\x1b\\
 * Every \x1b inside the sequence must be doubled.
 */
function wrapTmuxPassthrough(sequence: string): string {
	// Double every ESC (\x1b) in the sequence
	const escaped = sequence.replace(/\x1b/g, "\x1b\x1b");
	return `\x1bPtmux;${escaped}\x1b\\`;
}

/**
 * Unicode placeholder character for Kitty graphics protocol.
 * This character is in the Unicode Private Use Area and is used by terminals
 * that support the Kitty graphics protocol to mark where images should appear.
 */
const KITTY_PLACEHOLDER = "\u{10EEEE}";

/**
 * Auto-incrementing image ID counter for Kitty graphics protocol.
 * IDs must be non-zero, so we start at 1.
 */
let nextImageId = 1;

/**
 * Get the next available image ID.
 */
export function getNextImageId(): number {
	const id = nextImageId;
	nextImageId = (nextImageId % 0xffffff) + 1; // Wrap at 24 bits, skip 0
	return id;
}

/**
 * Encode image_id into RGB foreground color escape sequence.
 * The image_id is encoded in the 24-bit RGB value.
 */
function encodeImageIdAsFgColor(imageId: number): string {
	const r = (imageId >> 16) & 0xff;
	const g = (imageId >> 8) & 0xff;
	const b = imageId & 0xff;
	return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Maximum row/column value that can be encoded with diacritics.
 * The KITTY_DIACRITICS array has 297 entries (indices 0-296).
 */
const MAX_DIACRITIC_VALUE = KITTY_DIACRITICS.length - 1;

/**
 * Get the diacritic codepoint for a given row/column value.
 * Returns the character for the diacritic at the given index.
 */
function getDiacritic(value: number): string {
	if (value < 0 || value > MAX_DIACRITIC_VALUE) {
		// Clamp to valid range
		value = Math.max(0, Math.min(value, MAX_DIACRITIC_VALUE));
	}
	return String.fromCodePoint(KITTY_DIACRITICS[value]);
}

/**
 * Generate unicode placeholder rows for an image.
 * Uses inference optimization: only the first cell of each row includes the row diacritic,
 * subsequent cells are just the placeholder character (row and column inferred from left cell).
 * The foreground color encodes the image_id.
 */
export function generatePlaceholderRows(imageId: number, columns: number, rows: number): string[] {
	// Clamp to valid range: at least 1, at most diacritic limit
	const clampedRows = Math.max(1, Math.min(rows, MAX_DIACRITIC_VALUE + 1));
	const clampedCols = Math.max(1, Math.min(columns, MAX_DIACRITIC_VALUE + 1));

	const colorStart = encodeImageIdAsFgColor(imageId);
	const colorEnd = "\x1b[39m"; // Reset foreground color

	const result: string[] = [];
	for (let row = 0; row < clampedRows; row++) {
		// First cell: placeholder + row diacritic (column 0 inferred)
		// Subsequent cells: just placeholder (row and column inferred from left)
		const firstCell = KITTY_PLACEHOLDER + getDiacritic(row);
		const otherCells = clampedCols > 1 ? KITTY_PLACEHOLDER.repeat(clampedCols - 1) : "";
		result.push(`${colorStart}${firstCell}${otherCells}${colorEnd}`);
	}
	return result;
}

export function encodeKitty(
	base64Data: string,
	options: {
		columns?: number;
		rows?: number;
		imageId?: number;
		virtual?: boolean; // Use virtual placement (for tmux unicode placeholders)
	} = {},
): string {
	const CHUNK_SIZE = 4096;

	const params: string[] = ["f=100", "q=2"];

	// a=T means transmit and display
	// U=1 enables unicode placeholder mode (virtual placement)
	params.unshift("a=T");
	if (options.virtual) {
		params.push("U=1"); // Enable unicode placeholder mode
	}

	if (options.columns) params.push(`c=${options.columns}`);
	if (options.rows) params.push(`r=${options.rows}`);
	if (options.imageId) params.push(`i=${options.imageId}`);

	const inTmux = isInsideTmux();

	if (base64Data.length <= CHUNK_SIZE) {
		const seq = `\x1b_G${params.join(",")};${base64Data}\x1b\\`;
		return inTmux ? wrapTmuxPassthrough(seq) : seq;
	}

	const chunks: string[] = [];
	let offset = 0;
	let isFirst = true;

	while (offset < base64Data.length) {
		const chunk = base64Data.slice(offset, offset + CHUNK_SIZE);
		const isLast = offset + CHUNK_SIZE >= base64Data.length;

		let seq: string;
		if (isFirst) {
			seq = `\x1b_G${params.join(",")},m=1;${chunk}\x1b\\`;
			isFirst = false;
		} else if (isLast) {
			seq = `\x1b_Gm=0;${chunk}\x1b\\`;
		} else {
			seq = `\x1b_Gm=1;${chunk}\x1b\\`;
		}

		chunks.push(inTmux ? wrapTmuxPassthrough(seq) : seq);
		offset += CHUNK_SIZE;
	}

	return chunks.join("");
}

export function encodeITerm2(
	base64Data: string,
	options: {
		width?: number | string;
		height?: number | string;
		name?: string;
		preserveAspectRatio?: boolean;
		inline?: boolean;
	} = {},
): string {
	const params: string[] = [`inline=${options.inline !== false ? 1 : 0}`];

	if (options.width !== undefined) params.push(`width=${options.width}`);
	if (options.height !== undefined) params.push(`height=${options.height}`);
	if (options.name) {
		const nameBase64 = Buffer.from(options.name).toString("base64");
		params.push(`name=${nameBase64}`);
	}
	if (options.preserveAspectRatio === false) {
		params.push("preserveAspectRatio=0");
	}

	return `\x1b]1337;File=${params.join(";")}:${base64Data}\x07`;
}

export function calculateImageRows(
	imageDimensions: ImageDimensions,
	targetWidthCells: number,
	cellDimensions: CellDimensions = { widthPx: 9, heightPx: 18 },
): number {
	const targetWidthPx = targetWidthCells * cellDimensions.widthPx;
	const scale = targetWidthPx / imageDimensions.widthPx;
	const scaledHeightPx = imageDimensions.heightPx * scale;
	const rows = Math.ceil(scaledHeightPx / cellDimensions.heightPx);
	return Math.max(1, rows);
}

export function getPngDimensions(base64Data: string): ImageDimensions | null {
	try {
		const buffer = Buffer.from(base64Data, "base64");

		if (buffer.length < 24) {
			return null;
		}

		if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
			return null;
		}

		const width = buffer.readUInt32BE(16);
		const height = buffer.readUInt32BE(20);

		return { widthPx: width, heightPx: height };
	} catch {
		return null;
	}
}

export function getJpegDimensions(base64Data: string): ImageDimensions | null {
	try {
		const buffer = Buffer.from(base64Data, "base64");

		if (buffer.length < 2) {
			return null;
		}

		if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
			return null;
		}

		let offset = 2;
		while (offset < buffer.length - 9) {
			if (buffer[offset] !== 0xff) {
				offset++;
				continue;
			}

			const marker = buffer[offset + 1];

			if (marker >= 0xc0 && marker <= 0xc2) {
				const height = buffer.readUInt16BE(offset + 5);
				const width = buffer.readUInt16BE(offset + 7);
				return { widthPx: width, heightPx: height };
			}

			if (offset + 3 >= buffer.length) {
				return null;
			}
			const length = buffer.readUInt16BE(offset + 2);
			if (length < 2) {
				return null;
			}
			offset += 2 + length;
		}

		return null;
	} catch {
		return null;
	}
}

export function getGifDimensions(base64Data: string): ImageDimensions | null {
	try {
		const buffer = Buffer.from(base64Data, "base64");

		if (buffer.length < 10) {
			return null;
		}

		const sig = buffer.slice(0, 6).toString("ascii");
		if (sig !== "GIF87a" && sig !== "GIF89a") {
			return null;
		}

		const width = buffer.readUInt16LE(6);
		const height = buffer.readUInt16LE(8);

		return { widthPx: width, heightPx: height };
	} catch {
		return null;
	}
}

export function getWebpDimensions(base64Data: string): ImageDimensions | null {
	try {
		const buffer = Buffer.from(base64Data, "base64");

		if (buffer.length < 30) {
			return null;
		}

		const riff = buffer.slice(0, 4).toString("ascii");
		const webp = buffer.slice(8, 12).toString("ascii");
		if (riff !== "RIFF" || webp !== "WEBP") {
			return null;
		}

		const chunk = buffer.slice(12, 16).toString("ascii");
		if (chunk === "VP8 ") {
			if (buffer.length < 30) return null;
			const width = buffer.readUInt16LE(26) & 0x3fff;
			const height = buffer.readUInt16LE(28) & 0x3fff;
			return { widthPx: width, heightPx: height };
		} else if (chunk === "VP8L") {
			if (buffer.length < 25) return null;
			const bits = buffer.readUInt32LE(21);
			const width = (bits & 0x3fff) + 1;
			const height = ((bits >> 14) & 0x3fff) + 1;
			return { widthPx: width, heightPx: height };
		} else if (chunk === "VP8X") {
			if (buffer.length < 30) return null;
			const width = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1;
			const height = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1;
			return { widthPx: width, heightPx: height };
		}

		return null;
	} catch {
		return null;
	}
}

export function getImageDimensions(base64Data: string, mimeType: string): ImageDimensions | null {
	if (mimeType === "image/png") {
		return getPngDimensions(base64Data);
	}
	if (mimeType === "image/jpeg") {
		return getJpegDimensions(base64Data);
	}
	if (mimeType === "image/gif") {
		return getGifDimensions(base64Data);
	}
	if (mimeType === "image/webp") {
		return getWebpDimensions(base64Data);
	}
	return null;
}

export interface ImageRenderResult {
	sequence: string;
	rows: number;
	/** For tmux unicode placeholder mode: lines containing placeholder characters */
	placeholderLines?: string[];
}

export function renderImage(
	base64Data: string,
	imageDimensions: ImageDimensions,
	options: ImageRenderOptions = {},
): ImageRenderResult | null {
	const caps = getCapabilities();

	if (!caps.images) {
		return null;
	}

	const maxWidth = options.maxWidthCells ?? 80;
	const rows = calculateImageRows(imageDimensions, maxWidth, getCellDimensions());

	if (caps.images === "kitty") {
		const inTmux = isInsideTmux();

		if (inTmux) {
			// Check if passthrough is enabled - if not, fall back to text
			if (!isTmuxPassthroughEnabled()) {
				return null; // Will trigger fallback in Image component
			}

			// Clamp dimensions to diacritic limits for tmux unicode placeholder mode
			const tmuxMaxWidth = Math.max(1, Math.min(maxWidth, MAX_DIACRITIC_VALUE + 1));
			const tmuxRows = Math.max(1, Math.min(rows, MAX_DIACRITIC_VALUE + 1));

			// Use virtual placement with unicode placeholders for tmux
			const imageId = getNextImageId();
			const sequence = encodeKitty(base64Data, {
				columns: tmuxMaxWidth,
				rows: tmuxRows,
				imageId,
				virtual: true,
			});
			const placeholderLines = generatePlaceholderRows(imageId, tmuxMaxWidth, tmuxRows);
			return { sequence, rows: tmuxRows, placeholderLines };
		} else {
			// Direct placement for non-tmux (no diacritic limits)
			const sequence = encodeKitty(base64Data, { columns: maxWidth, rows });
			return { sequence, rows };
		}
	}

	if (caps.images === "iterm2") {
		const sequence = encodeITerm2(base64Data, {
			width: maxWidth,
			height: "auto",
			preserveAspectRatio: options.preserveAspectRatio ?? true,
		});
		return { sequence, rows };
	}

	return null;
}

export function imageFallback(mimeType: string, dimensions?: ImageDimensions, filename?: string): string {
	const parts: string[] = [];
	if (filename) parts.push(filename);
	parts.push(`[${mimeType}]`);
	if (dimensions) parts.push(`${dimensions.widthPx}x${dimensions.heightPx}`);
	return `[Image: ${parts.join(" ")}]`;
}
