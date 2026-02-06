import { PLACEHOLDER_DIACRITICS } from "./placeholder-diacritics.js";

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
	/** Kitty image ID. If provided, reuses/replaces existing image with this ID. */
	imageId?: number;
}

let cachedCapabilities: TerminalCapabilities | null = null;

/**
 * Check if the process is running inside tmux.
 */
export function isInTmux(): boolean {
	return !!process.env.TMUX;
}

/**
 * Wrap an escape sequence in tmux DCS passthrough.
 * Every ESC (\x1b) in the payload is doubled, then wrapped in \x1bPtmux;...\x1b\\
 * Requires `set -g allow-passthrough on` in tmux.conf.
 */
export function wrapTmuxPassthrough(sequence: string): string {
	const escaped = sequence.replaceAll("\x1b", "\x1b\x1b");
	return `\x1bPtmux;${escaped}\x1b\\`;
}

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

const KITTY_PREFIX = "\x1b_G";
const ITERM2_PREFIX = "\x1b]1337;File=";

/**
 * Unicode placeholder character for Kitty graphics protocol.
 * Terminals that support this render the referenced image at cells containing this char.
 */
const PLACEHOLDER_CHAR = "\u{10EEEE}";

export function isImageLine(line: string): boolean {
	// Fast path: sequence at line start (single-row images)
	if (line.startsWith(KITTY_PREFIX) || line.startsWith(ITERM2_PREFIX)) {
		return true;
	}
	// Slow path: sequence elsewhere (multi-row images have cursor-up prefix)
	if (line.includes(KITTY_PREFIX) || line.includes(ITERM2_PREFIX)) {
		return true;
	}
	// Unicode placeholder lines (kitty protocol in tmux)
	return line.includes(PLACEHOLDER_CHAR);
}

/**
 * Generate a random image ID for Kitty graphics protocol.
 * Uses random IDs to avoid collisions between different module instances
 * (e.g., main app vs extensions).
 */
export function allocateImageId(): number {
	// Use random ID in range [1, 0xffffffff] to avoid collisions
	return Math.floor(Math.random() * 0xfffffffe) + 1;
}

/**
 * Allocate an image ID suitable for Unicode placeholder mode (24-bit).
 * The ID is encoded in the foreground truecolor, so it must fit in 24 bits.
 */
export function allocatePlaceholderImageId(): number {
	return Math.floor(Math.random() * 0xfffffe) + 1;
}

/**
 * Transmit image data to the terminal without displaying it (a=t).
 * Used for Unicode placeholder mode where display is handled by placeholder characters.
 * Always wraps in tmux passthrough since this is only used in tmux.
 */
function encodeKittyTransmit(base64Data: string, imageId: number): string {
	const CHUNK_SIZE = 4096;

	const params: string[] = [`a=t`, "f=100", "q=2", `i=${imageId}`];

	if (base64Data.length <= CHUNK_SIZE) {
		return wrapTmuxPassthrough(`\x1b_G${params.join(",")};${base64Data}\x1b\\`);
	}

	const chunks: string[] = [];
	let offset = 0;
	let isFirst = true;

	while (offset < base64Data.length) {
		const chunk = base64Data.slice(offset, offset + CHUNK_SIZE);
		const isLast = offset + CHUNK_SIZE >= base64Data.length;

		if (isFirst) {
			chunks.push(wrapTmuxPassthrough(`\x1b_G${params.join(",")},m=1;${chunk}\x1b\\`));
			isFirst = false;
		} else if (isLast) {
			chunks.push(wrapTmuxPassthrough(`\x1b_Gm=0;${chunk}\x1b\\`));
		} else {
			chunks.push(wrapTmuxPassthrough(`\x1b_Gm=1;${chunk}\x1b\\`));
		}

		offset += CHUNK_SIZE;
	}

	return chunks.join("");
}

/**
 * Generate Unicode placeholder text lines for a Kitty image.
 * Each cell contains U+10EEEE with a row diacritic on the first cell of each row.
 * The foreground color encodes the 24-bit image ID.
 * See: https://sw.kovidgoyal.net/kitty/graphics-protocol/#unicode-placeholders
 */
function generatePlaceholderLines(imageId: number, columns: number, rows: number): string[] {
	const r = (imageId >> 16) & 0xff;
	const g = (imageId >> 8) & 0xff;
	const b = imageId & 0xff;
	const colorStart = `\x1b[38;2;${r};${g};${b}m`;
	const colorEnd = `\x1b[39m`;

	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		const rowDiacritic = String.fromCodePoint(PLACEHOLDER_DIACRITICS[row]);
		// First cell gets row diacritic, subsequent cells inherit via shorthand
		let line = colorStart + PLACEHOLDER_CHAR + rowDiacritic;
		for (let col = 1; col < columns; col++) {
			line += PLACEHOLDER_CHAR;
		}
		line += colorEnd;
		lines.push(line);
	}
	return lines;
}

/**
 * Render an image using Kitty Unicode placeholder mode for tmux.
 * Transmits image data via passthrough, creates virtual placement,
 * and returns placeholder text lines that tmux handles as normal text.
 */
export function renderKittyUnicodePlaceholder(
	base64Data: string,
	options: {
		columns: number;
		rows: number;
		imageId: number;
	},
): { transmitSequence: string; placeholderLines: string[]; imageId: number } {
	const { columns, rows, imageId } = options;

	// Step 1: Transmit image data (no display) via passthrough
	const transmitSeq = encodeKittyTransmit(base64Data, imageId);

	// Step 2: Create virtual placement via passthrough
	const placementSeq = wrapTmuxPassthrough(`\x1b_Ga=p,U=1,i=${imageId},c=${columns},r=${rows},q=2\x1b\\`);

	// Step 3: Generate placeholder text lines
	const placeholderLines = generatePlaceholderLines(imageId, columns, rows);

	return {
		transmitSequence: transmitSeq + placementSeq,
		placeholderLines,
		imageId,
	};
}

export function encodeKitty(
	base64Data: string,
	options: {
		columns?: number;
		rows?: number;
		imageId?: number;
	} = {},
): string {
	const CHUNK_SIZE = 4096;

	const params: string[] = ["a=T", "f=100", "q=2"];

	if (options.columns) params.push(`c=${options.columns}`);
	if (options.rows) params.push(`r=${options.rows}`);
	if (options.imageId) params.push(`i=${options.imageId}`);

	if (base64Data.length <= CHUNK_SIZE) {
		return `\x1b_G${params.join(",")};${base64Data}\x1b\\`;
	}

	const chunks: string[] = [];
	let offset = 0;
	let isFirst = true;

	while (offset < base64Data.length) {
		const chunk = base64Data.slice(offset, offset + CHUNK_SIZE);
		const isLast = offset + CHUNK_SIZE >= base64Data.length;

		if (isFirst) {
			chunks.push(`\x1b_G${params.join(",")},m=1;${chunk}\x1b\\`);
			isFirst = false;
		} else if (isLast) {
			chunks.push(`\x1b_Gm=0;${chunk}\x1b\\`);
		} else {
			chunks.push(`\x1b_Gm=1;${chunk}\x1b\\`);
		}

		offset += CHUNK_SIZE;
	}

	return chunks.join("");
}

/**
 * Delete a Kitty graphics image by ID.
 * Uses uppercase 'I' to also free the image data.
 */
export function deleteKittyImage(imageId: number): string {
	const seq = `\x1b_Ga=d,d=I,i=${imageId}\x1b\\`;
	return isInTmux() ? wrapTmuxPassthrough(seq) : seq;
}

/**
 * Delete all visible Kitty graphics images.
 * Uses uppercase 'A' to also free the image data.
 */
export function deleteAllKittyImages(): string {
	const seq = `\x1b_Ga=d,d=A\x1b\\`;
	return isInTmux() ? wrapTmuxPassthrough(seq) : seq;
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

export interface RenderImageResult {
	/** Escape sequence for direct image display (non-placeholder mode). */
	sequence: string;
	/** Number of rows the image occupies. */
	rows: number;
	/** Image ID used (if any). */
	imageId?: number;
	/** Unicode placeholder text lines for tmux mode. When present, use these as visible content. */
	placeholderLines?: string[];
}

export function renderImage(
	base64Data: string,
	imageDimensions: ImageDimensions,
	options: ImageRenderOptions = {},
): RenderImageResult | null {
	const caps = getCapabilities();

	if (!caps.images) {
		return null;
	}

	const maxWidth = options.maxWidthCells ?? 80;
	const rows = calculateImageRows(imageDimensions, maxWidth, getCellDimensions());

	if (caps.images === "kitty") {
		// In tmux: use Unicode placeholder mode for proper pane-relative rendering
		if (isInTmux()) {
			// Placeholder IDs are encoded in 24-bit foreground color, so mask to 24 bits
			const imageId = (options.imageId ?? allocatePlaceholderImageId()) & 0xffffff;
			// Row encoding uses diacritics table — cap to available entries
			const placeholderRows = Math.min(rows, PLACEHOLDER_DIACRITICS.length);
			const result = renderKittyUnicodePlaceholder(base64Data, {
				columns: maxWidth,
				rows: placeholderRows,
				imageId,
			});
			return {
				sequence: result.transmitSequence,
				rows,
				imageId: result.imageId,
				placeholderLines: result.placeholderLines,
			};
		}

		// Direct mode: transmit and display in one step
		const sequence = encodeKitty(base64Data, { columns: maxWidth, rows, imageId: options.imageId });
		return { sequence, rows, imageId: options.imageId };
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
