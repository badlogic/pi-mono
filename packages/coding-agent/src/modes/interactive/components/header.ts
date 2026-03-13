import type { Component } from "@apholdings/jensen-tui";
import type { ExtensionAPI } from "../../../core/extensions/index.js";

type RGB = { r: number; g: number; b: number };
type Glyph7 = [string, string, string, string, string, string, string];
type Glyph5 = [string, string, string, string, string];
type PixelKind = "empty" | "face" | "detail" | "highlight";

const ANSI_ESCAPE_GLOBAL = /\x1b\[[0-9;]*m/g;
const ANSI_ESCAPE_AT_START = /^\x1b\[[0-9;]*m/;

const TITLE = "[JENSEN]";
const MINI_TITLE = "[J]";

const faceStops: RGB[] = [
	{ r: 0x1a, g: 0xf5, b: 0x8a },
	{ r: 0x57, g: 0xe3, b: 0xf7 },
	{ r: 0x8c, g: 0xb6, b: 0xff },
	{ r: 0xc0, g: 0x7b, b: 0xff },
];

const detailStops: RGB[] = [
	{ r: 0x0e, g: 0x8a, b: 0x53 },
	{ r: 0x2c, g: 0x86, b: 0xa2 },
	{ r: 0x5a, g: 0x6d, b: 0xb8 },
	{ r: 0x7f, g: 0x4b, b: 0xb6 },
];

const shadowStops: RGB[] = [
	{ r: 0x05, g: 0x2a, b: 0x19 },
	{ r: 0x0b, g: 0x22, b: 0x3a },
	{ r: 0x19, g: 0x12, b: 0x33 },
];

function g7(...rows: string[]): Glyph7 {
	return rows as Glyph7;
}

function g5(...rows: string[]): Glyph5 {
	return rows as Glyph5;
}

function stripAnsi(input: string): string {
	return input.replace(ANSI_ESCAPE_GLOBAL, "");
}

function visibleWidth(input: string): number {
	return Array.from(stripAnsi(input)).length;
}

function truncatePlain(input: string, maxWidth: number): string {
	if (maxWidth <= 0) return "";

	let out = "";
	let width = 0;

	for (const ch of Array.from(input)) {
		if (width >= maxWidth) break;
		out += ch;
		width += 1;
	}

	return out;
}

function truncateToWidth(input: string, maxWidth: number, ellipsis = ""): string {
	if (maxWidth <= 0) return "";
	if (visibleWidth(input) <= maxWidth) return input;

	const ellipsisWidth = visibleWidth(ellipsis);
	if (ellipsisWidth >= maxWidth) return truncatePlain(ellipsis, maxWidth);

	const targetWidth = maxWidth - ellipsisWidth;
	let i = 0;
	let width = 0;
	let out = "";
	let sawAnsi = false;

	while (i < input.length && width < targetWidth) {
		const rest = input.slice(i);
		const ansi = rest.match(ANSI_ESCAPE_AT_START);
		if (ansi) {
			out += ansi[0];
			sawAnsi = true;
			i += ansi[0].length;
			continue;
		}

		const cp = input.codePointAt(i);
		if (cp == null) break;

		const ch = String.fromCodePoint(cp);
		if (width + 1 > targetWidth) break;

		out += ch;
		width += 1;
		i += ch.length;
	}

	if (ellipsis) out += ellipsis;
	if (sawAnsi) out += "\x1b[0m";

	return out;
}

function color(rgb: RGB, text: string): string {
	return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\x1b[0m`;
}

function interpolateStops(stops: RGB[], t: number): RGB {
	if (stops.length === 1) return stops[0];

	const clamped = Math.max(0, Math.min(1, t));
	const scaled = clamped * (stops.length - 1);
	const i = Math.min(Math.floor(scaled), stops.length - 2);
	const f = scaled - i;

	return {
		r: Math.round(stops[i].r + (stops[i + 1].r - stops[i].r) * f),
		g: Math.round(stops[i].g + (stops[i + 1].g - stops[i].g) * f),
		b: Math.round(stops[i].b + (stops[i + 1].b - stops[i].b) * f),
	};
}

function brighten(rgb: RGB, amount: number): RGB {
	return {
		r: Math.min(255, rgb.r + amount),
		g: Math.min(255, rgb.g + amount),
		b: Math.min(255, rgb.b + amount),
	};
}

function glyphWidth<T extends readonly string[]>(glyph: T): number {
	return Math.max(...glyph.map((row) => row.length));
}

function classifyPixel(ch: string): PixelKind {
	if (ch === " ") return "empty";
	if (ch === "█") return "face";
	if (ch === "░") return "detail";
	if (ch === "▓") return "highlight";
	return "face";
}

const LARGE_GLYPHS: Record<string, Glyph7> = {
	// UFO
	"[": g7(
		"   ▓███████▓   ",
		"  ███████████  ",
		" ███░░░░░░░███ ",
		"███████████████",
		"░░▓██▓░▓░▓██▓░░",
		"░░▓██▓░▓░▓██▓░░",
		"░▓█▓▓░▓▓▓░▓▓█▓░",
	),

	// ALIEN
	"]": g7(
		"  ████████████  ",
		" ███░▓░░░░░▓░███ ",
		"██░░░░█░░░█░░░░██",
		"██░░░░░░░░░░░░░██",
		"██░░░░█▓█▓█░░░░██",
		" ███░░░░░░░░░███ ",
		"  ████████████  ",
	),

	" ": g7("   ", "   ", "   ", "   ", "   ", "   ", "   "),

	J: g7("████████", "░░░░██░ ", "  ░░██  ", "  ░░██  ", "██░░██  ", "██░░██  ", "░█████  "),

	E: g7("█████████", "███░░░░██", "███ ░█   ", "██████  ", "███░░█   ", "███░░  ██", "█████████"),

	N: g7("████░░░████", " ████░░░░██", " ██░██░░░██", " ██░░██░░██", " ██ ░░██░██", " ██  ░░████", "███   ░░███"),

	S: g7(" ████████ ", "███░░░░███", "░███      ", " ░██████  ", "   ░░░███ ", "███░░░░███", " ████████ "),
};

const COMPACT_GLYPHS: Record<string, Glyph5> = {
	// Tiny UFO
	"[": ["  ▓█████▓  ", " █████████ ", "███░░░░░███", "░░██▓░▓██░░", " ░█▓▓░▓▓█░ "],

	// ALIEN - Scaled down to 5 rows
	"]": [" █████████ ", "██░▓░░░▓░██", "█░░░█░█░░░█", "█░░░░░░░░░█", " █████████ "],

	" ": g5(" ", " ", " ", " ", " "),

	J: ["███████", "  ░░██ ", "  ░░██ ", "██░░██ ", "░█████ "],

	E: ["████████", "███░░░█ ", "██████  ", "███░░ █ ", "████████"],

	N: ["███░░░██", "██░█░░██", "██░░█░██", "██ ░░███", "███ ░░██"],

	S: [" ██████ ", "███░░░░ ", " ░█████ ", " ░░░░███", " ██████ "],
};

function buildBitmap<T extends readonly string[]>(
	text: string,
	glyphs: Record<string, T>,
	rows: number,
	gap: number,
): { pixels: PixelKind[][]; width: number; height: number } {
	const chars = Array.from(text).map((ch) => glyphs[ch] ?? glyphs[" "]);

	let totalWidth = 0;
	chars.forEach((glyph, index) => {
		totalWidth += glyphWidth(glyph);
		if (index < chars.length - 1) totalWidth += gap;
	});

	const pixels = Array.from({ length: rows }, () => Array<PixelKind>(totalWidth).fill("empty"));

	let cursorX = 0;
	chars.forEach((glyph, index) => {
		const width = glyphWidth(glyph);

		for (let y = 0; y < rows; y++) {
			const row = glyph[y].padEnd(width, " ");
			for (let x = 0; x < width; x++) {
				pixels[y][cursorX + x] = classifyPixel(row[x]);
			}
		}

		cursorX += width;
		if (index < chars.length - 1) cursorX += gap;
	});

	return { pixels, width: totalWidth, height: rows };
}

function renderBitmapLogo(options: {
	width: number;
	pixels: PixelKind[][];
	bitmapWidth: number;
	bitmapHeight: number;
	indent?: number;
	shadowOffsetX?: number;
	shadowOffsetY?: number;
}): string[] {
	const { width, pixels, bitmapWidth, bitmapHeight, indent = 1, shadowOffsetX = 2, shadowOffsetY = 1 } = options;

	if (width <= 0) return [""];

	// Face is shifted right inside the render canvas so the cast shadow can live on the left.
	const renderWidth = bitmapWidth + shadowOffsetX;
	const renderHeight = bitmapHeight + shadowOffsetY;
	const lines: string[] = [""];

	for (let y = 0; y < renderHeight; y++) {
		let line = " ".repeat(Math.max(0, indent));

		for (let x = 0; x < renderWidth; x++) {
			const faceSourceX = x - shadowOffsetX;
			const facePixel =
				y >= 0 && y < bitmapHeight && faceSourceX >= 0 && faceSourceX < bitmapWidth
					? pixels[y][faceSourceX]
					: "empty";

			const shadowSourceX = x;
			const shadowSourceY = y - shadowOffsetY;
			const shadowPixel =
				shadowSourceX >= 0 && shadowSourceX < bitmapWidth && shadowSourceY >= 0 && shadowSourceY < bitmapHeight
					? pixels[shadowSourceY][shadowSourceX]
					: "empty";

			const shadowOn = facePixel === "empty" && shadowPixel !== "empty";

			if (facePixel === "face") {
				const t = bitmapWidth > 1 ? faceSourceX / (bitmapWidth - 1) : 0;
				line += color(interpolateStops(faceStops, t), "█");
			} else if (facePixel === "detail") {
				const t = bitmapWidth > 1 ? faceSourceX / (bitmapWidth - 1) : 0;
				line += color(interpolateStops(detailStops, t), "█");
			} else if (facePixel === "highlight") {
				const t = bitmapWidth > 1 ? faceSourceX / (bitmapWidth - 1) : 0;
				line += color(brighten(interpolateStops(faceStops, t), 28), "█");
			} else if (shadowOn) {
				const t = bitmapWidth > 1 ? shadowSourceX / (bitmapWidth - 1) : 0;
				line += color(interpolateStops(shadowStops, t), "█");
			} else {
				line += " ";
			}
		}

		lines.push(truncateToWidth(line, width));
	}

	return lines.map((line) => truncateToWidth(line, width));
}

function renderMicroFallback(width: number): string[] {
	if (width <= 0) return [""];

	let line = "";
	const chars = Array.from(MINI_TITLE);
	const plainWidth = chars.length;

	chars.forEach((ch, i) => {
		if (ch === " ") {
			line += " ";
			return;
		}

		const t = plainWidth > 1 ? i / (plainWidth - 1) : 0;
		line += color(interpolateStops(faceStops, t), ch);
	});

	return ["", truncateToWidth(line, width, "")];
}

function renderResponsiveLogo(width: number): string[] {
	const large = buildBitmap(TITLE, LARGE_GLYPHS, 7, 1);
	const largeNeeded = 1 + large.width + 1;

	const compact = buildBitmap(TITLE, COMPACT_GLYPHS, 5, 1);
	const compactNeeded = 1 + compact.width + 1;

	const mini = buildBitmap(MINI_TITLE, COMPACT_GLYPHS, 5, 1);
	const miniNeeded = 1 + mini.width + 1;

	if (width >= largeNeeded) {
		return renderBitmapLogo({
			width,
			pixels: large.pixels,
			bitmapWidth: large.width,
			bitmapHeight: large.height,
			indent: 1,
			shadowOffsetX: 2,
			shadowOffsetY: 1,
		});
	}

	if (width >= compactNeeded) {
		return renderBitmapLogo({
			width,
			pixels: compact.pixels,
			bitmapWidth: compact.width,
			bitmapHeight: compact.height,
			indent: 1,
			shadowOffsetX: 1,
			shadowOffsetY: 1,
		});
	}

	if (width >= miniNeeded) {
		return renderBitmapLogo({
			width,
			pixels: mini.pixels,
			bitmapWidth: mini.width,
			bitmapHeight: mini.height,
			indent: 1,
			shadowOffsetX: 1,
			shadowOffsetY: 1,
		});
	}

	return renderMicroFallback(width);
}

export class Header implements Component {
	render(width: number): string[] {
		return renderResponsiveLogo(width);
	}

	invalidate(): void {}
}

export default function jensenHeader(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setHeader((_tui, _theme) => new Header());
	});
}
