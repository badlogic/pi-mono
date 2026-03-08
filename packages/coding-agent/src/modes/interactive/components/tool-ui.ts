import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";

export type ToolBlockState = "pending" | "running" | "success" | "error" | "warning";

export interface ToolStatusLineOptions {
	state: ToolBlockState;
	title: string;
	description?: string;
	meta?: string[];
}

export interface OutputBlockSection {
	label?: string;
	lines: string[];
}

export interface OutputBlockOptions {
	header: string;
	state: ToolBlockState;
	sections?: OutputBlockSection[];
	width: number;
	applyBg?: boolean;
}

const STATUS_SYMBOLS: Record<ToolBlockState, string> = {
	pending: "○",
	running: "◌",
	success: "✓",
	error: "✕",
	warning: "!",
};

const BORDER_HORIZONTAL = "─";
const BORDER_VERTICAL = "│";
const DOT_SEPARATOR = " · ";
const BRACKET_LEFT = "[";
const BRACKET_RIGHT = "]";

export function humanizeToolName(name: string): string {
	switch (name) {
		case "ls":
			return "LS";
		case "grep":
			return "Grep";
		case "find":
			return "Find";
		case "read":
			return "Read";
		case "write":
			return "Write";
		case "edit":
			return "Edit";
		case "bash":
			return "Bash";
		default:
			return name
				.split("_")
				.filter(Boolean)
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join(" ");
	}
}

export function clampDisplayLine(line: string, maxChars = 4000): string {
	if (line.length <= maxChars) {
		return line;
	}
	const omitted = line.length - maxChars;
	return `${line.slice(0, maxChars)}… [${omitted} chars omitted]`;
}

export function formatExpandHint(expanded: boolean, keyHintText: string, hasMore: boolean): string {
	if (expanded || !hasMore) {
		return "";
	}
	return theme.fg("dim", `(${keyHintText} for more)`);
}

export function formatExecutionDuration(durationMs: number | undefined): string | undefined {
	if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
		return undefined;
	}
	if (durationMs < 1000) {
		return `${Math.round(durationMs)}ms`;
	}
	if (durationMs < 10_000) {
		return `${(durationMs / 1000).toFixed(1)}s`;
	}
	const totalSeconds = Math.floor(durationMs / 1000);
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const remainingSeconds = totalSeconds % 60;
	if (minutes < 60) {
		return `${minutes}m ${remainingSeconds}s`;
	}
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}

export function renderToolStatusLine(options: ToolStatusLineOptions): string {
	const symbol = formatStatusSymbol(options.state);
	const title = theme.fg("accent", options.title);
	let line = `${symbol} ${title}`;

	if (options.description) {
		line += `: ${theme.fg("muted", options.description)}`;
	}

	const meta = options.meta?.filter((value) => value.trim().length > 0) ?? [];
	if (meta.length > 0) {
		line += ` ${theme.fg("dim", meta.join(DOT_SEPARATOR))}`;
	}

	return line;
}

export function renderOutputBlock(options: OutputBlockOptions): string[] {
	const { header, state, sections = [], width, applyBg = true } = options;
	const blockWidth = Math.max(1, width);
	const borderColor = getBorderColor(state);
	const bgFn = applyBg ? getBackgroundFn(state) : undefined;
	const topLeft = theme.fg(borderColor, "┌───");
	const topRight = theme.fg(borderColor, "┐");
	const bottomLeft = theme.fg(borderColor, "└───");
	const bottomRight = theme.fg(borderColor, "┘");
	const contentPrefix = theme.fg(borderColor, `${BORDER_VERTICAL} `);
	const contentSuffix = theme.fg(borderColor, BORDER_VERTICAL);
	const contentWidth = Math.max(0, blockWidth - visibleWidth(contentPrefix) - visibleWidth(contentSuffix));
	const lines: string[] = [];

	lines.push(
		applyBackground(
			`${topLeft}${fillLine(header, blockWidth, topLeft, topRight, borderColor)}${topRight}`,
			blockWidth,
			bgFn,
		),
	);

	const normalizedSections = sections.length > 0 ? sections : [{ lines: [] }];
	for (const section of normalizedSections) {
		if (section.label) {
			const left = theme.fg(borderColor, "├───");
			const right = theme.fg(borderColor, "┤");
			lines.push(
				applyBackground(
					`${left}${fillLine(section.label, blockWidth, left, right, borderColor)}${right}`,
					blockWidth,
					bgFn,
				),
			);
		}
		for (const rawLine of section.lines) {
			const wrappedLines = wrapTextWithAnsi(rawLine.trimEnd(), Math.max(1, contentWidth));
			for (const wrappedLine of wrappedLines.length > 0 ? wrappedLines : [""]) {
				const fullLine = `${contentPrefix}${wrappedLine}${" ".repeat(Math.max(0, contentWidth - visibleWidth(wrappedLine)))}${contentSuffix}`;
				lines.push(applyBackground(fullLine, blockWidth, bgFn));
			}
		}
	}

	lines.push(
		applyBackground(
			`${bottomLeft}${theme.fg(borderColor, BORDER_HORIZONTAL.repeat(Math.max(0, blockWidth - visibleWidth(bottomLeft) - visibleWidth(bottomRight))))}${bottomRight}`,
			blockWidth,
			bgFn,
		),
	);

	return lines;
}

export class CachedOutputBlock {
	private cacheKey?: string;
	private cacheLines?: string[];

	render(options: OutputBlockOptions): string[] {
		const key = JSON.stringify(options);
		if (this.cacheKey === key && this.cacheLines) {
			return this.cacheLines;
		}
		const lines = renderOutputBlock(options);
		this.cacheKey = key;
		this.cacheLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cacheKey = undefined;
		this.cacheLines = undefined;
	}
}

function formatStatusSymbol(state: ToolBlockState): string {
	const symbol = STATUS_SYMBOLS[state];
	switch (state) {
		case "success":
			return theme.fg("success", symbol);
		case "error":
			return theme.fg("error", symbol);
		case "warning":
			return theme.fg("warning", symbol);
		case "running":
			return theme.fg("accent", symbol);
		default:
			return theme.fg("muted", symbol);
	}
}

function fillLine(
	content: string,
	width: number,
	left: string,
	right: string,
	borderColor: "accent" | "success" | "error" | "warning" | "borderMuted" = "accent",
): string {
	const header = content ? ` ${content} ` : " ";
	const maxHeaderWidth = Math.max(0, width - visibleWidth(left) - visibleWidth(right));
	const trimmedHeader = truncateToWidth(header, maxHeaderWidth);
	const remaining = Math.max(0, width - visibleWidth(left) - visibleWidth(trimmedHeader) - visibleWidth(right));
	return `${trimmedHeader}${theme.fg(borderColor, BORDER_HORIZONTAL.repeat(remaining))}`;
}

function getBorderColor(state: ToolBlockState): "accent" | "success" | "error" | "warning" | "borderMuted" {
	switch (state) {
		case "success":
			return "success";
		case "error":
			return "error";
		case "warning":
			return "warning";
		case "pending":
		case "running":
			return "accent";
		default:
			return "borderMuted";
	}
}

function getBackgroundFn(state: ToolBlockState): ((text: string) => string) | undefined {
	switch (state) {
		case "success":
			return (text: string) => theme.bg("toolSuccessBg", text);
		case "error":
			return (text: string) => theme.bg("toolErrorBg", text);
		case "pending":
		case "running":
		case "warning":
			return (text: string) => theme.bg("toolPendingBg", text);
		default:
			return undefined;
	}
}

function applyBackground(line: string, width: number, bgFn?: (text: string) => string): string {
	const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
	return bgFn ? bgFn(padded) : padded;
}

export function formatBracketLabel(label: string, color: "success" | "error" | "warning" | "accent" | "muted"): string {
	return theme.fg(color, `${BRACKET_LEFT}${label}${BRACKET_RIGHT}`);
}
