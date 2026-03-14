import { createRequire } from "node:module";
import os from "node:os";
import { type Component, truncateToWidth, visibleWidth } from "@apholdings/jensen-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../../../package.json") as {
	title?: string;
	version?: string;
	displayTitle?: string;
	productTitle?: string;
};

type RGB = { r: number; g: number; b: number };
const ANSI_ESCAPE_AT_START = /^\x1b\[[0-9;]*m/;

const TITLE = packageJson.displayTitle ?? packageJson.productTitle ?? packageJson.title ?? "Jensen Code";

const VERSION = packageJson.version ? `v${packageJson.version}` : "v0.0.0";

const LOGO = [" █████████ ", "██▓░░░░░▓██", "█░░░█░█░░░█", "█░░░░░░░░░█", " █████████ "];

const GRADIENT_STOPS: RGB[] = [
	{ r: 0x1a, g: 0xf5, b: 0x8a },
	{ r: 0x57, g: 0xe3, b: 0xf7 },
	{ r: 0x8c, g: 0xb6, b: 0xff },
	{ r: 0xc0, g: 0x7b, b: 0xff },
];

const COLORS = {
	border: { r: 0x72, g: 0x7c, b: 0xb0 },
	title: { r: 0xd5, g: 0xd6, b: 0xdb },
	muted: { r: 0x7a, g: 0x84, b: 0xb2 },
	subtle: { r: 0x56, g: 0x5f, b: 0x89 },
	accent: { r: 0xa1, g: 0x88, b: 0xf1 },
};

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

function truncateAnsi(input: string, maxWidth: number, ellipsis = ""): string {
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

function bold(text: string): string {
	return `\x1b[1m${text}\x1b[0m`;
}

function dim(text: string): string {
	return `\x1b[38;2;${COLORS.muted.r};${COLORS.muted.g};${COLORS.muted.b}m${text}\x1b[0m`;
}

function subtle(text: string): string {
	return `\x1b[38;2;${COLORS.subtle.r};${COLORS.subtle.g};${COLORS.subtle.b}m${text}\x1b[0m`;
}

function interpolateStops(stops: RGB[], t: number): RGB {
	if (stops.length === 0) return { r: 0, g: 0, b: 0 };
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

function renderColoredLogoLine(line: string): string {
	const chars = Array.from(line);
	const width = chars.length;

	let out = "";
	chars.forEach((ch, i) => {
		if (ch === " ") {
			out += " ";
			return;
		}
		const t = width > 1 ? i / (width - 1) : 0;
		out += color(interpolateStops(GRADIENT_STOPS, t), ch);
	});

	return out;
}

function compactPath(input: string, maxWidth = 44): string {
	const normalized = input.replaceAll("/", process.platform === "win32" ? "\\" : "/");
	if (normalized.length <= maxWidth) return normalized;

	const separator = normalized.includes("\\") ? "\\" : "/";
	const parts = normalized.split(separator).filter(Boolean);
	if (parts.length <= 2) return normalized;

	const first = normalized.startsWith(separator) ? separator : "";
	const driveMatch = parts[0]?.match(/^[A-Za-z]:$/);
	const head = driveMatch ? `${parts[0]}${separator}` : first;
	const tail = parts.slice(-2).join(separator);
	return `${head}…${separator}${tail}`;
}

function padAnsi(input: string, width: number): string {
	const remaining = Math.max(0, width - visibleWidth(input));
	return input + " ".repeat(remaining);
}

function bulletJoin(parts: Array<string | undefined>): string {
	return parts.filter((part) => Boolean(part && part.trim().length > 0)).join(` ${subtle("•")} `);
}

function maybePrefix(label: string, value: string | undefined): string | undefined {
	if (!value) return undefined;
	return `${dim(label)} ${value}`;
}

export class Header implements Component {
	constructor(
		private readonly agentSession?: AgentSession,
		private readonly footerDataProvider?: ReadonlyFooterDataProvider,
	) {}

	private getData() {
		const host = `${os.userInfo().username}@${os.hostname()}`;
		const cwd = process.cwd();
		const repo = this.footerDataProvider?.getGitRepoName() ?? undefined;
		const branch = this.footerDataProvider?.getGitBranch() ?? undefined;
		const workspace = this.agentSession?.sessionName;

		return {
			branch,
			cwd,
			host,
			repo,
			workspace,
		};
	}

	private renderCompact(width: number): string[] {
		const { branch, cwd, host, repo, workspace } = this.getData();

		const line1 = truncateAnsi(`${bold(color(COLORS.title, TITLE))} ${dim(VERSION)}`, width);
		const line2 = subtle(truncateAnsi(bulletJoin([maybePrefix("repo", repo), maybePrefix("branch", branch)]), width));
		const line3 = subtle(
			truncateAnsi(bulletJoin([maybePrefix("workspace", workspace), maybePrefix("host", host)]), width),
		);
		const line4 = subtle(truncateAnsi(maybePrefix("cwd", compactPath(cwd, Math.max(16, width - 8))) ?? "", width));

		return [line1, line2, line3, line4];
	}

	render(width: number): string[] {
		if (width <= 0) return [""];
		if (width < 72) return this.renderCompact(width);

		const { branch, cwd, host, repo, workspace } = this.getData();
		const logoWidth = visibleWidth(LOGO[0]);
		const gap = 2;
		const sidePadding = 1;
		const minTextWidth = 12;
		const maxTextWidth = Math.max(minTextWidth, width - logoWidth - gap - sidePadding * 2 - 2);

		const baseRows = [
			`${bold(color(COLORS.title, TITLE))} ${dim(VERSION)}`,
			color(COLORS.title, bulletJoin([maybePrefix("repo", repo), maybePrefix("branch", branch)])),
			color(COLORS.title, bulletJoin([maybePrefix("workspace", workspace), maybePrefix("host", host)])),
			"",
		];

		const textRows = [
			...baseRows,
			color(COLORS.title, maybePrefix("cwd", compactPath(cwd, Math.max(18, maxTextWidth - 10))) ?? ""),
			"",
		];
		const textWidth = Math.max(
			minTextWidth,
			Math.min(
				maxTextWidth,
				textRows.reduce((max, row) => Math.max(max, visibleWidth(row)), 0),
			),
		);
		const innerWidth = logoWidth + gap + textWidth + sidePadding * 2;

		const topBorder =
			color(COLORS.border, "╭") + color(COLORS.border, "─".repeat(innerWidth)) + color(COLORS.border, "╮");

		const bottomBorder =
			color(COLORS.border, "╰") + color(COLORS.border, "─".repeat(innerWidth)) + color(COLORS.border, "╯");

		const lines: string[] = [];

		// lines.push("");
		lines.push(topBorder);
		for (let i = 0; i < LOGO.length; i += 1) {
			const logo = renderColoredLogoLine(LOGO[i]);
			const text = padAnsi(truncateAnsi(textRows[i] ?? "", textWidth), textWidth);

			lines.push(`${color(COLORS.border, "│")} ${logo}${" ".repeat(gap)}${text} ${color(COLORS.border, "│")}`);
		}
		lines.push(bottomBorder);
		// lines.push("");
		return lines.map((line) => truncateToWidth(line, width));
	}

	invalidate(): void {}
}

export default Header;
