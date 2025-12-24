import type { AgentState } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, writeFileSync } from "fs";
import hljs from "highlight.js";
import { marked } from "marked";
import { homedir } from "os";
import * as path from "path";
import { basename } from "path";
import { APP_NAME, getCustomThemesDir, getThemesDir, VERSION } from "../config.js";
import { type BashExecutionMessage, isBashExecutionMessage } from "./messages.js";
import type { SessionManager } from "./session-manager.js";

// ============================================================================
// Types
// ============================================================================

interface MessageEvent {
	type: "message";
	message: Message;
	timestamp?: number;
}

interface ModelChangeEvent {
	type: "model_change";
	provider: string;
	modelId: string;
	timestamp?: number;
}

interface CompactionEvent {
	type: "compaction";
	timestamp: string;
	summary: string;
	tokensBefore: number;
}

type SessionEvent = MessageEvent | ModelChangeEvent | CompactionEvent;

interface ParsedSessionData {
	sessionId: string;
	timestamp: string;
	systemPrompt?: string;
	modelsUsed: Set<string>;
	messages: Message[];
	toolResultsMap: Map<string, ToolResultMessage>;
	sessionEvents: SessionEvent[];
	tokenStats: { input: number; output: number; cacheRead: number; cacheWrite: number };
	costStats: { input: number; output: number; cacheRead: number; cacheWrite: number };
	tools?: { name: string; description: string }[];
	contextWindow?: number;
	isStreamingFormat?: boolean;
}

// ============================================================================
// Theme Types and Loading
// ============================================================================

interface ThemeJson {
	name: string;
	vars?: Record<string, string | number>;
	colors: Record<string, string | number>;
}

interface ThemeColors {
	// Core UI
	accent: string;
	border: string;
	borderAccent: string;
	success: string;
	error: string;
	warning: string;
	muted: string;
	dim: string;
	text: string;
	// Backgrounds
	userMessageBg: string;
	userMessageText: string;
	toolPendingBg: string;
	toolSuccessBg: string;
	toolErrorBg: string;
	toolOutput: string;
	// Markdown
	mdHeading: string;
	mdLink: string;
	mdLinkUrl: string;
	mdCode: string;
	mdCodeBlock: string;
	mdCodeBlockBorder: string;
	mdQuote: string;
	mdQuoteBorder: string;
	mdHr: string;
	mdListBullet: string;
	// Diffs
	toolDiffAdded: string;
	toolDiffRemoved: string;
	toolDiffContext: string;
	// Syntax highlighting
	syntaxComment: string;
	syntaxKeyword: string;
	syntaxFunction: string;
	syntaxVariable: string;
	syntaxString: string;
	syntaxNumber: string;
	syntaxType: string;
	syntaxOperator: string;
	syntaxPunctuation: string;
}

/** Resolve a theme color value, following variable references until we get a final value. */
function resolveColorValue(
	value: string | number,
	vars: Record<string, string | number>,
	defaultValue: string,
	visited = new Set<string>(),
): string {
	if (value === "") return defaultValue;
	if (typeof value !== "string") return defaultValue;
	if (visited.has(value)) return defaultValue;
	if (!(value in vars)) return value; // Return as-is (hex colors work in CSS)
	visited.add(value);
	return resolveColorValue(vars[value], vars, defaultValue, visited);
}

/** Load theme JSON from built-in or custom themes directory. */
function loadThemeJson(name: string): ThemeJson | null {
	// Try built-in themes first
	const themesDir = getThemesDir();
	const builtinPath = path.join(themesDir, `${name}.json`);
	if (existsSync(builtinPath)) {
		try {
			return JSON.parse(readFileSync(builtinPath, "utf-8")) as ThemeJson;
		} catch {
			return null;
		}
	}

	// Try custom themes
	const customThemesDir = getCustomThemesDir();
	const customPath = path.join(customThemesDir, `${name}.json`);
	if (existsSync(customPath)) {
		try {
			return JSON.parse(readFileSync(customPath, "utf-8")) as ThemeJson;
		} catch {
			return null;
		}
	}

	return null;
}

/** Build complete theme colors object, resolving theme JSON values against defaults. */
function getThemeColors(themeName?: string): ThemeColors {
	const isLight = isLightTheme(themeName);

	// Default colors based on theme type
	const defaultColors: ThemeColors = isLight
		? {
				// Light theme defaults
				accent: "rgb(95, 135, 135)",
				border: "rgb(95, 135, 175)",
				borderAccent: "rgb(95, 135, 135)",
				success: "rgb(135, 175, 135)",
				error: "rgb(175, 95, 95)",
				warning: "rgb(215, 175, 95)",
				muted: "rgb(108, 108, 108)",
				dim: "rgb(138, 138, 138)",
				text: "rgb(0, 0, 0)",
				userMessageBg: "rgb(232, 232, 232)",
				userMessageText: "rgb(0, 0, 0)",
				toolPendingBg: "rgb(232, 232, 240)",
				toolSuccessBg: "rgb(232, 240, 232)",
				toolErrorBg: "rgb(240, 232, 232)",
				toolOutput: "rgb(108, 108, 108)",
				mdHeading: "rgb(215, 175, 95)",
				mdLink: "rgb(95, 135, 175)",
				mdLinkUrl: "rgb(138, 138, 138)",
				mdCode: "rgb(95, 135, 135)",
				mdCodeBlock: "rgb(135, 175, 135)",
				mdCodeBlockBorder: "rgb(108, 108, 108)",
				mdQuote: "rgb(108, 108, 108)",
				mdQuoteBorder: "rgb(108, 108, 108)",
				mdHr: "rgb(108, 108, 108)",
				mdListBullet: "rgb(135, 175, 135)",
				toolDiffAdded: "rgb(135, 175, 135)",
				toolDiffRemoved: "rgb(175, 95, 95)",
				toolDiffContext: "rgb(108, 108, 108)",
				syntaxComment: "rgb(0, 128, 0)",
				syntaxKeyword: "rgb(0, 0, 255)",
				syntaxFunction: "rgb(121, 94, 38)",
				syntaxVariable: "rgb(0, 16, 128)",
				syntaxString: "rgb(163, 21, 21)",
				syntaxNumber: "rgb(9, 134, 88)",
				syntaxType: "rgb(38, 127, 153)",
				syntaxOperator: "rgb(0, 0, 0)",
				syntaxPunctuation: "rgb(0, 0, 0)",
			}
		: {
				// Dark theme defaults
				accent: "rgb(138, 190, 183)",
				border: "rgb(95, 135, 255)",
				borderAccent: "rgb(0, 215, 255)",
				success: "rgb(181, 189, 104)",
				error: "rgb(204, 102, 102)",
				warning: "rgb(255, 255, 0)",
				muted: "rgb(128, 128, 128)",
				dim: "rgb(102, 102, 102)",
				text: "rgb(229, 229, 231)",
				userMessageBg: "rgb(52, 53, 65)",
				userMessageText: "rgb(229, 229, 231)",
				toolPendingBg: "rgb(40, 40, 50)",
				toolSuccessBg: "rgb(40, 50, 40)",
				toolErrorBg: "rgb(60, 40, 40)",
				toolOutput: "rgb(128, 128, 128)",
				mdHeading: "rgb(240, 198, 116)",
				mdLink: "rgb(129, 162, 190)",
				mdLinkUrl: "rgb(102, 102, 102)",
				mdCode: "rgb(138, 190, 183)",
				mdCodeBlock: "rgb(181, 189, 104)",
				mdCodeBlockBorder: "rgb(128, 128, 128)",
				mdQuote: "rgb(128, 128, 128)",
				mdQuoteBorder: "rgb(128, 128, 128)",
				mdHr: "rgb(128, 128, 128)",
				mdListBullet: "rgb(138, 190, 183)",
				toolDiffAdded: "rgb(181, 189, 104)",
				toolDiffRemoved: "rgb(204, 102, 102)",
				toolDiffContext: "rgb(128, 128, 128)",
				syntaxComment: "rgb(106, 153, 85)",
				syntaxKeyword: "rgb(86, 156, 214)",
				syntaxFunction: "rgb(220, 220, 170)",
				syntaxVariable: "rgb(156, 220, 254)",
				syntaxString: "rgb(206, 145, 120)",
				syntaxNumber: "rgb(181, 206, 168)",
				syntaxType: "rgb(78, 201, 176)",
				syntaxOperator: "rgb(212, 212, 212)",
				syntaxPunctuation: "rgb(212, 212, 212)",
			};

	if (!themeName) return defaultColors;

	const themeJson = loadThemeJson(themeName);
	if (!themeJson) return defaultColors;

	const vars = themeJson.vars || {};
	const colors = themeJson.colors;

	const resolve = (key: keyof ThemeColors): string => {
		const value = colors[key];
		if (value === undefined) return defaultColors[key];
		return resolveColorValue(value, vars, defaultColors[key]);
	};

	return {
		accent: resolve("accent"),
		border: resolve("border"),
		borderAccent: resolve("borderAccent"),
		success: resolve("success"),
		error: resolve("error"),
		warning: resolve("warning"),
		muted: resolve("muted"),
		dim: resolve("dim"),
		text: resolve("text"),
		userMessageBg: resolve("userMessageBg"),
		userMessageText: resolve("userMessageText"),
		toolPendingBg: resolve("toolPendingBg"),
		toolSuccessBg: resolve("toolSuccessBg"),
		toolErrorBg: resolve("toolErrorBg"),
		toolOutput: resolve("toolOutput"),
		mdHeading: resolve("mdHeading"),
		mdLink: resolve("mdLink"),
		mdLinkUrl: resolve("mdLinkUrl"),
		mdCode: resolve("mdCode"),
		mdCodeBlock: resolve("mdCodeBlock"),
		mdCodeBlockBorder: resolve("mdCodeBlockBorder"),
		mdQuote: resolve("mdQuote"),
		mdQuoteBorder: resolve("mdQuoteBorder"),
		mdHr: resolve("mdHr"),
		mdListBullet: resolve("mdListBullet"),
		toolDiffAdded: resolve("toolDiffAdded"),
		toolDiffRemoved: resolve("toolDiffRemoved"),
		toolDiffContext: resolve("toolDiffContext"),
		syntaxComment: resolve("syntaxComment"),
		syntaxKeyword: resolve("syntaxKeyword"),
		syntaxFunction: resolve("syntaxFunction"),
		syntaxVariable: resolve("syntaxVariable"),
		syntaxString: resolve("syntaxString"),
		syntaxNumber: resolve("syntaxNumber"),
		syntaxType: resolve("syntaxType"),
		syntaxOperator: resolve("syntaxOperator"),
		syntaxPunctuation: resolve("syntaxPunctuation"),
	};
}

/** Check if theme is a light theme (currently only matches "light" exactly). */
function isLightTheme(themeName?: string): boolean {
	return themeName === "light";
}

// ============================================================================
// Utility functions
// ============================================================================

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function shortenPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

function formatTimestamp(timestamp: number | string | undefined): string {
	if (!timestamp) return "";
	const date = new Date(typeof timestamp === "string" ? timestamp : timestamp);
	return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Highlight code using highlight.js. Returns HTML with syntax highlighting spans. */
function highlightCode(code: string, lang?: string): string {
	if (!lang) {
		return escapeHtml(code);
	}
	try {
		// Check if language is supported
		if (hljs.getLanguage(lang)) {
			return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
		}
		// Try common aliases
		const aliases: Record<string, string> = {
			ts: "typescript",
			js: "javascript",
			py: "python",
			rb: "ruby",
			sh: "bash",
			yml: "yaml",
			md: "markdown",
		};
		const aliasedLang = aliases[lang];
		if (aliasedLang && hljs.getLanguage(aliasedLang)) {
			return hljs.highlight(code, { language: aliasedLang, ignoreIllegals: true }).value;
		}
	} catch {
		// Fall through to escaped output
	}
	return escapeHtml(code);
}

/** Get language from file path extension. */
function getLanguageFromPath(filePath: string): string | undefined {
	const ext = filePath.split(".").pop()?.toLowerCase();
	if (!ext) return undefined;

	const extToLang: Record<string, string> = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		py: "python",
		rb: "ruby",
		rs: "rust",
		go: "go",
		java: "java",
		kt: "kotlin",
		swift: "swift",
		c: "c",
		h: "c",
		cpp: "cpp",
		cc: "cpp",
		cxx: "cpp",
		hpp: "cpp",
		cs: "csharp",
		php: "php",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		fish: "bash",
		ps1: "powershell",
		sql: "sql",
		html: "html",
		htm: "html",
		xml: "xml",
		css: "css",
		scss: "scss",
		sass: "scss",
		less: "less",
		json: "json",
		yaml: "yaml",
		yml: "yaml",
		toml: "toml",
		ini: "ini",
		md: "markdown",
		markdown: "markdown",
		dockerfile: "dockerfile",
		makefile: "makefile",
		cmake: "cmake",
		lua: "lua",
		r: "r",
		scala: "scala",
		clj: "clojure",
		cljs: "clojure",
		ex: "elixir",
		exs: "elixir",
		erl: "erlang",
		hrl: "erlang",
		hs: "haskell",
		ml: "ocaml",
		mli: "ocaml",
		fs: "fsharp",
		fsx: "fsharp",
		vue: "vue",
		svelte: "xml",
		tf: "hcl",
		hcl: "hcl",
		proto: "protobuf",
		graphql: "graphql",
		gql: "graphql",
	};

	return extToLang[ext];
}

/** Render markdown to HTML server-side with TUI-style code block formatting and syntax highlighting. */
function renderMarkdown(text: string): string {
	// Custom renderer for code blocks to match TUI style
	const renderer = new marked.Renderer();
	renderer.code = ({ text: code, lang }: { text: string; lang?: string }) => {
		const language = lang || "";
		const highlighted = highlightCode(code, lang);
		return (
			'<div class="code-block-wrapper">' +
			`<div class="code-block-header">\`\`\`${language}</div>` +
			`<pre><code class="hljs">${highlighted}</code></pre>` +
			'<div class="code-block-footer">```</div>' +
			"</div>"
		);
	};

	// Configure marked for safe rendering
	marked.setOptions({
		breaks: true,
		gfm: true,
	});

	// Parse markdown (marked escapes HTML by default in newer versions)
	return marked.parse(text, { renderer }) as string;
}

function formatExpandableOutput(lines: string[], maxLines: number, lang?: string): string {
	const displayLines = lines.slice(0, maxLines);
	const remaining = lines.length - maxLines;

	// If language is provided, highlight the entire code block
	if (lang) {
		const code = lines.join("\n");
		const highlighted = highlightCode(code, lang);

		if (remaining > 0) {
			// For expandable, we need preview and full versions
			const previewCode = displayLines.join("\n");
			const previewHighlighted = highlightCode(previewCode, lang);

			let out = '<div class="tool-output expandable" onclick="this.classList.toggle(\'expanded\')">';
			out += `<div class="output-preview"><pre><code class="hljs">${previewHighlighted}</code></pre>`;
			out += `<div class="expand-hint">... (${remaining} more lines) - click to expand</div>`;
			out += "</div>";
			out += `<div class="output-full"><pre><code class="hljs">${highlighted}</code></pre></div></div>`;
			return out;
		}

		return `<div class="tool-output"><pre><code class="hljs">${highlighted}</code></pre></div>`;
	}

	// No language - plain text output
	if (remaining > 0) {
		let out = '<div class="tool-output expandable" onclick="this.classList.toggle(\'expanded\')">';
		out += '<div class="output-preview">';
		for (const line of displayLines) {
			out += `<div>${escapeHtml(replaceTabs(line))}</div>`;
		}
		out += `<div class="expand-hint">... (${remaining} more lines) - click to expand</div>`;
		out += "</div>";
		out += '<div class="output-full">';
		for (const line of lines) {
			out += `<div>${escapeHtml(replaceTabs(line))}</div>`;
		}
		out += "</div></div>";
		return out;
	}

	let out = '<div class="tool-output">';
	for (const line of displayLines) {
		out += `<div>${escapeHtml(replaceTabs(line))}</div>`;
	}
	out += "</div>";
	return out;
}

// ============================================================================
// Parsing functions
// ============================================================================

function parseSessionManagerFormat(lines: string[]): ParsedSessionData {
	const data: ParsedSessionData = {
		sessionId: "unknown",
		timestamp: new Date().toISOString(),
		modelsUsed: new Set(),
		messages: [],
		toolResultsMap: new Map(),
		sessionEvents: [],
		tokenStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		costStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};

	for (const line of lines) {
		let entry: { type: string; [key: string]: unknown };
		try {
			entry = JSON.parse(line) as { type: string; [key: string]: unknown };
		} catch {
			continue;
		}

		switch (entry.type) {
			case "session":
				data.sessionId = (entry.id as string) || "unknown";
				data.timestamp = (entry.timestamp as string) || data.timestamp;
				data.systemPrompt = entry.systemPrompt as string | undefined;
				if (entry.modelId) {
					const modelInfo = entry.provider ? `${entry.provider}/${entry.modelId}` : (entry.modelId as string);
					data.modelsUsed.add(modelInfo);
				}
				break;

			case "message": {
				const message = entry.message as Message;
				data.messages.push(message);
				data.sessionEvents.push({
					type: "message",
					message,
					timestamp: entry.timestamp as number | undefined,
				});

				if (message.role === "toolResult") {
					const toolResult = message as ToolResultMessage;
					data.toolResultsMap.set(toolResult.toolCallId, toolResult);
				} else if (message.role === "assistant") {
					const assistantMsg = message as AssistantMessage;
					if (assistantMsg.usage) {
						data.tokenStats.input += assistantMsg.usage.input || 0;
						data.tokenStats.output += assistantMsg.usage.output || 0;
						data.tokenStats.cacheRead += assistantMsg.usage.cacheRead || 0;
						data.tokenStats.cacheWrite += assistantMsg.usage.cacheWrite || 0;
						if (assistantMsg.usage.cost) {
							data.costStats.input += assistantMsg.usage.cost.input || 0;
							data.costStats.output += assistantMsg.usage.cost.output || 0;
							data.costStats.cacheRead += assistantMsg.usage.cost.cacheRead || 0;
							data.costStats.cacheWrite += assistantMsg.usage.cost.cacheWrite || 0;
						}
					}
				}
				break;
			}

			case "model_change":
				data.sessionEvents.push({
					type: "model_change",
					provider: entry.provider as string,
					modelId: entry.modelId as string,
					timestamp: entry.timestamp as number | undefined,
				});
				if (entry.modelId) {
					const modelInfo = entry.provider ? `${entry.provider}/${entry.modelId}` : (entry.modelId as string);
					data.modelsUsed.add(modelInfo);
				}
				break;

			case "compaction":
				data.sessionEvents.push({
					type: "compaction",
					timestamp: entry.timestamp as string,
					summary: entry.summary as string,
					tokensBefore: entry.tokensBefore as number,
				});
				break;
		}
	}

	return data;
}

function parseStreamingEventFormat(lines: string[]): ParsedSessionData {
	const data: ParsedSessionData = {
		sessionId: "unknown",
		timestamp: new Date().toISOString(),
		modelsUsed: new Set(),
		messages: [],
		toolResultsMap: new Map(),
		sessionEvents: [],
		tokenStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		costStats: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		isStreamingFormat: true,
	};

	let timestampSet = false;

	for (const line of lines) {
		let entry: { type: string; message?: Message };
		try {
			entry = JSON.parse(line) as { type: string; message?: Message };
		} catch {
			continue;
		}

		if (entry.type === "message_end" && entry.message) {
			const msg = entry.message;
			data.messages.push(msg);
			data.sessionEvents.push({
				type: "message",
				message: msg,
				timestamp: (msg as { timestamp?: number }).timestamp,
			});

			if (msg.role === "toolResult") {
				const toolResult = msg as ToolResultMessage;
				data.toolResultsMap.set(toolResult.toolCallId, toolResult);
			} else if (msg.role === "assistant") {
				const assistantMsg = msg as AssistantMessage;
				if (assistantMsg.model) {
					const modelInfo = assistantMsg.provider
						? `${assistantMsg.provider}/${assistantMsg.model}`
						: assistantMsg.model;
					data.modelsUsed.add(modelInfo);
				}
				if (assistantMsg.usage) {
					data.tokenStats.input += assistantMsg.usage.input || 0;
					data.tokenStats.output += assistantMsg.usage.output || 0;
					data.tokenStats.cacheRead += assistantMsg.usage.cacheRead || 0;
					data.tokenStats.cacheWrite += assistantMsg.usage.cacheWrite || 0;
					if (assistantMsg.usage.cost) {
						data.costStats.input += assistantMsg.usage.cost.input || 0;
						data.costStats.output += assistantMsg.usage.cost.output || 0;
						data.costStats.cacheRead += assistantMsg.usage.cost.cacheRead || 0;
						data.costStats.cacheWrite += assistantMsg.usage.cost.cacheWrite || 0;
					}
				}
			}

			if (!timestampSet && (msg as { timestamp?: number }).timestamp) {
				data.timestamp = new Date((msg as { timestamp: number }).timestamp).toISOString();
				timestampSet = true;
			}
		}
	}

	data.sessionId = `stream-${data.timestamp.replace(/[:.]/g, "-")}`;
	return data;
}

function detectFormat(lines: string[]): "session-manager" | "streaming-events" | "unknown" {
	for (const line of lines) {
		try {
			const entry = JSON.parse(line) as { type: string };
			if (entry.type === "session") return "session-manager";
			if (entry.type === "agent_start" || entry.type === "message_start" || entry.type === "turn_start") {
				return "streaming-events";
			}
		} catch {}
	}
	return "unknown";
}

function parseSessionFile(content: string): ParsedSessionData {
	const lines = content
		.trim()
		.split("\n")
		.filter((l) => l.trim());

	if (lines.length === 0) {
		throw new Error("Empty session file");
	}

	const format = detectFormat(lines);
	if (format === "unknown") {
		throw new Error("Unknown session file format");
	}

	return format === "session-manager" ? parseSessionManagerFormat(lines) : parseStreamingEventFormat(lines);
}

// ============================================================================
// HTML formatting functions
// ============================================================================

function formatToolExecution(
	toolName: string,
	args: Record<string, unknown>,
	result: ToolResultMessage | undefined,
	colors: ThemeColors,
): { html: string; bgColor: string } {
	let html = "";
	const isError = result?.isError || false;
	const bgColor = result ? (isError ? colors.toolErrorBg : colors.toolSuccessBg) : colors.toolPendingBg;

	const getTextOutput = (): string => {
		if (!result) return "";
		const textBlocks = result.content.filter((c) => c.type === "text");
		return textBlocks.map((c) => (c as { type: "text"; text: string }).text).join("\n");
	};

	switch (toolName) {
		case "bash": {
			const command = (args?.command as string) || "";
			html = `<div class="tool-command">$ ${escapeHtml(command || "...")}</div>`;
			if (result) {
				const output = getTextOutput().trim();
				if (output) {
					html += formatExpandableOutput(output.split("\n"), 5);
				}
			}
			break;
		}

		case "read": {
			const filePath = (args?.file_path as string) || (args?.path as string) || "";
			const shortenedPath = shortenPath(filePath);
			const offset = args?.offset as number | undefined;
			const limit = args?.limit as number | undefined;
			const lang = getLanguageFromPath(filePath);

			// Build path display with offset/limit suffix
			let pathHtml = escapeHtml(shortenedPath || "...");
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				pathHtml += `<span class="line-numbers">:${startLine}${endLine ? `-${endLine}` : ""}</span>`;
			}

			html = `<div class="tool-header"><span class="tool-name">read</span> <span class="tool-path">${pathHtml}</span></div>`;
			if (result) {
				const output = getTextOutput();
				if (output) {
					html += formatExpandableOutput(output.split("\n"), 10, lang);
				}
			}
			break;
		}

		case "write": {
			const filePath = (args?.file_path as string) || (args?.path as string) || "";
			const shortenedPath = shortenPath(filePath);
			const fileContent = (args?.content as string) || "";
			const lines = fileContent ? fileContent.split("\n") : [];
			const lang = getLanguageFromPath(filePath);

			html = `<div class="tool-header"><span class="tool-name">write</span> <span class="tool-path">${escapeHtml(shortenedPath || "...")}</span>`;
			if (lines.length > 10) {
				html += ` <span class="line-count">(${lines.length} lines)</span>`;
			}
			html += "</div>";

			if (fileContent) {
				html += formatExpandableOutput(lines, 10, lang);
			}
			if (result) {
				const output = getTextOutput().trim();
				if (output) {
					html += `<div class="tool-output"><div>${escapeHtml(output)}</div></div>`;
				}
			}
			break;
		}

		case "edit": {
			const path = shortenPath((args?.file_path as string) || (args?.path as string) || "");
			html = `<div class="tool-header"><span class="tool-name">edit</span> <span class="tool-path">${escapeHtml(path || "...")}</span></div>`;

			if (result?.details?.diff) {
				const diffLines = result.details.diff.split("\n");
				html += '<div class="tool-diff">';
				for (const line of diffLines) {
					if (line.startsWith("+")) {
						html += `<div class="diff-line-new">${escapeHtml(line)}</div>`;
					} else if (line.startsWith("-")) {
						html += `<div class="diff-line-old">${escapeHtml(line)}</div>`;
					} else {
						html += `<div class="diff-line-context">${escapeHtml(line)}</div>`;
					}
				}
				html += "</div>";
			}
			if (result) {
				const output = getTextOutput().trim();
				if (output) {
					html += `<div class="tool-output"><div>${escapeHtml(output)}</div></div>`;
				}
			}
			break;
		}

		default: {
			html = `<div class="tool-header"><span class="tool-name">${escapeHtml(toolName)}</span></div>`;
			html += `<div class="tool-output"><pre>${escapeHtml(JSON.stringify(args, null, 2))}</pre></div>`;
			if (result) {
				const output = getTextOutput();
				if (output) {
					html += `<div class="tool-output"><div>${escapeHtml(output)}</div></div>`;
				}
			}
		}
	}

	return { html, bgColor };
}

function formatMessage(message: Message, toolResultsMap: Map<string, ToolResultMessage>, colors: ThemeColors): string {
	let html = "";
	const timestamp = (message as { timestamp?: number }).timestamp;
	const timestampHtml = timestamp ? `<div class="message-timestamp">${formatTimestamp(timestamp)}</div>` : "";

	// Handle bash execution messages (user-executed via ! command)
	if (isBashExecutionMessage(message)) {
		const bashMsg = message as unknown as BashExecutionMessage;
		const isError = bashMsg.cancelled || (bashMsg.exitCode !== 0 && bashMsg.exitCode !== null);

		html += `<div class="tool-execution user-bash${isError ? " user-bash-error" : ""}">`;
		html += timestampHtml;
		html += `<div class="tool-command">$ ${escapeHtml(bashMsg.command)}</div>`;

		if (bashMsg.output) {
			const lines = bashMsg.output.split("\n");
			html += formatExpandableOutput(lines, 10);
		}

		if (bashMsg.cancelled) {
			html += `<div class="bash-status warning">(cancelled)</div>`;
		} else if (bashMsg.exitCode !== 0 && bashMsg.exitCode !== null) {
			html += `<div class="bash-status error">(exit ${bashMsg.exitCode})</div>`;
		}

		if (bashMsg.truncated && bashMsg.fullOutputPath) {
			html += `<div class="bash-truncation warning">Output truncated. Full output: ${escapeHtml(bashMsg.fullOutputPath)}</div>`;
		}

		html += `</div>`;
		return html;
	}

	if (message.role === "user") {
		const userMsg = message as UserMessage;
		let textContent = "";
		const images: ImageContent[] = [];

		if (typeof userMsg.content === "string") {
			textContent = userMsg.content;
		} else {
			for (const block of userMsg.content) {
				if (block.type === "text") {
					textContent += block.text;
				} else if (block.type === "image") {
					images.push(block as ImageContent);
				}
			}
		}

		html += `<div class="user-message">${timestampHtml}`;

		// Render images first
		if (images.length > 0) {
			html += `<div class="message-images">`;
			for (const img of images) {
				html += `<img src="data:${img.mimeType};base64,${img.data}" alt="User uploaded image" class="message-image" />`;
			}
			html += `</div>`;
		}

		// Render text as markdown (server-side)
		if (textContent.trim()) {
			html += `<div class="markdown-content">${renderMarkdown(textContent)}</div>`;
		}

		html += `</div>`;
	} else if (message.role === "assistant") {
		const assistantMsg = message as AssistantMessage;
		html += timestampHtml ? `<div class="assistant-message">${timestampHtml}` : "";

		for (const content of assistantMsg.content) {
			if (content.type === "text" && content.text.trim()) {
				// Render markdown server-side
				html += `<div class="assistant-text markdown-content">${renderMarkdown(content.text)}</div>`;
			} else if (content.type === "thinking" && content.thinking.trim()) {
				html += `<div class="thinking-text">${escapeHtml(content.thinking.trim()).replace(/\n/g, "<br>")}</div>`;
			}
		}

		for (const content of assistantMsg.content) {
			if (content.type === "toolCall") {
				const toolResult = toolResultsMap.get(content.id);
				const { html: toolHtml, bgColor } = formatToolExecution(
					content.name,
					content.arguments as Record<string, unknown>,
					toolResult,
					colors,
				);
				html += `<div class="tool-execution" style="background-color: ${bgColor}">${toolHtml}</div>`;
			}
		}

		const hasToolCalls = assistantMsg.content.some((c) => c.type === "toolCall");
		if (!hasToolCalls) {
			if (assistantMsg.stopReason === "aborted") {
				html += '<div class="error-text">Aborted</div>';
			} else if (assistantMsg.stopReason === "error") {
				html += `<div class="error-text">Error: ${escapeHtml(assistantMsg.errorMessage || "Unknown error")}</div>`;
			}
		}

		if (timestampHtml) {
			html += "</div>";
		}
	}

	return html;
}

function formatModelChange(event: ModelChangeEvent): string {
	const timestamp = formatTimestamp(event.timestamp);
	const timestampHtml = timestamp ? `<div class="message-timestamp">${timestamp}</div>` : "";
	const modelInfo = `${event.provider}/${event.modelId}`;
	return `<div class="model-change">${timestampHtml}<div class="model-change-text">Switched to model: <span class="model-name">${escapeHtml(modelInfo)}</span></div></div>`;
}

function formatCompaction(event: CompactionEvent): string {
	const timestamp = formatTimestamp(event.timestamp);
	const timestampHtml = timestamp ? `<div class="message-timestamp">${timestamp}</div>` : "";
	const summaryHtml = escapeHtml(event.summary).replace(/\n/g, "<br>");

	return `<div class="compaction-container">
		<div class="compaction-header" onclick="this.parentElement.classList.toggle('expanded')">
			${timestampHtml}
			<div class="compaction-header-row">
				<span class="compaction-toggle">▶</span>
				<span class="compaction-title">Context compacted from ${event.tokensBefore.toLocaleString()} tokens</span>
				<span class="compaction-hint">(click to expand summary)</span>
			</div>
		</div>
		<div class="compaction-content">
			<div class="compaction-summary">
				<div class="compaction-summary-header">Summary sent to model</div>
				<div class="compaction-summary-content">${summaryHtml}</div>
			</div>
		</div>
	</div>`;
}

// ============================================================================
// HTML generation
// ============================================================================

function generateHtml(data: ParsedSessionData, filename: string, colors: ThemeColors, isLight: boolean): string {
	const userMessages = data.messages.filter((m) => m.role === "user").length;
	const assistantMessages = data.messages.filter((m) => m.role === "assistant").length;

	let toolCallsCount = 0;
	for (const message of data.messages) {
		if (message.role === "assistant") {
			toolCallsCount += (message as AssistantMessage).content.filter((c) => c.type === "toolCall").length;
		}
	}

	const lastAssistantMessage = data.messages
		.slice()
		.reverse()
		.find((m) => m.role === "assistant" && (m as AssistantMessage).stopReason !== "aborted") as
		| AssistantMessage
		| undefined;

	const contextTokens = lastAssistantMessage
		? lastAssistantMessage.usage.input +
			lastAssistantMessage.usage.output +
			lastAssistantMessage.usage.cacheRead +
			lastAssistantMessage.usage.cacheWrite
		: 0;

	const lastModel = lastAssistantMessage?.model || "unknown";
	const lastProvider = lastAssistantMessage?.provider || "";
	const lastModelInfo = lastProvider ? `${lastProvider}/${lastModel}` : lastModel;

	const contextWindow = data.contextWindow || 0;
	const contextPercent = contextWindow > 0 ? ((contextTokens / contextWindow) * 100).toFixed(1) : null;

	let messagesHtml = "";
	for (const event of data.sessionEvents) {
		switch (event.type) {
			case "message":
				if (event.message.role !== "toolResult") {
					messagesHtml += formatMessage(event.message, data.toolResultsMap, colors);
				}
				break;
			case "model_change":
				messagesHtml += formatModelChange(event);
				break;
			case "compaction":
				messagesHtml += formatCompaction(event);
				break;
		}
	}

	const systemPromptHtml = data.systemPrompt
		? `<div class="system-prompt">
            <div class="system-prompt-header">System Prompt</div>
            <div class="system-prompt-content">${escapeHtml(data.systemPrompt)}</div>
        </div>`
		: "";

	const toolsHtml = data.tools
		? `<div class="tools-list">
            <div class="tools-header">Available Tools</div>
            <div class="tools-content">
                ${data.tools.map((tool) => `<div class="tool-item"><span class="tool-item-name">${escapeHtml(tool.name)}</span> - ${escapeHtml(tool.description)}</div>`).join("")}
            </div>
        </div>`
		: "";

	const streamingNotice = data.isStreamingFormat
		? `<div class="streaming-notice">
            <em>Note: This session was reconstructed from raw agent event logs, which do not contain system prompt or tool definitions.</em>
        </div>`
		: "";

	const contextUsageText = contextPercent
		? `${contextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${contextPercent}%) - ${escapeHtml(lastModelInfo)}`
		: `${contextTokens.toLocaleString()} tokens (last turn) - ${escapeHtml(lastModelInfo)}`;

	// Compute body background based on theme
	const bodyBg = isLight ? "rgb(248, 248, 248)" : "rgb(24, 24, 30)";
	const containerBg = isLight ? "rgb(255, 255, 255)" : "rgb(30, 30, 36)";
	const compactionBg = isLight ? "rgb(255, 248, 220)" : "rgb(60, 55, 35)";
	const systemPromptBg = isLight ? "rgb(255, 250, 230)" : "rgb(60, 55, 40)";
	const streamingNoticeBg = isLight ? "rgb(250, 245, 235)" : "rgb(50, 45, 35)";
	const modelChangeBg = isLight ? "rgb(240, 240, 250)" : "rgb(40, 40, 50)";
	const userBashBg = isLight ? "rgb(255, 250, 240)" : "rgb(50, 48, 35)";
	const userBashErrorBg = isLight ? "rgb(255, 245, 235)" : "rgb(60, 45, 35)";

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Session Export - ${escapeHtml(filename)}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
            font-size: 12px;
            line-height: 1.6;
            color: ${colors.text};
            background: ${bodyBg};
            padding: 24px;
        }
        .container { max-width: 700px; margin: 0 auto; }
        .header {
            margin-bottom: 24px;
            padding: 16px;
            background: ${containerBg};
            border-radius: 4px;
        }
        .header h1 {
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 12px;
            color: ${colors.borderAccent};
        }
        .header-info { display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
        .info-item { color: ${colors.dim}; display: flex; align-items: baseline; }
        .info-label { font-weight: 600; margin-right: 8px; min-width: 100px; }
        .info-value { color: ${colors.text}; flex: 1; }
        .info-value.cost { font-family: 'SF Mono', monospace; }
        .messages { display: flex; flex-direction: column; gap: 16px; }
        .message-timestamp { font-size: 10px; color: ${colors.dim}; margin-bottom: 4px; opacity: 0.8; }
        .user-message {
            background: ${colors.userMessageBg};
            color: ${colors.userMessageText};
            padding: 12px 16px;
            border-radius: 4px;
        }
        .assistant-message { padding: 0; }
        .assistant-text, .thinking-text {
            padding: 12px 16px;
        }
        .thinking-text { color: ${colors.dim}; font-style: italic; white-space: pre-wrap; }
        .model-change { padding: 8px 16px; background: ${modelChangeBg}; border-radius: 4px; }
        .model-change-text { color: ${colors.dim}; font-size: 11px; }
        .model-name { color: ${colors.borderAccent}; font-weight: bold; }
        .compaction-container { background: ${compactionBg}; border-radius: 4px; overflow: hidden; }
        .compaction-header { padding: 12px 16px; cursor: pointer; }
        .compaction-header:hover { background: rgba(${isLight ? "0, 0, 0" : "255, 255, 255"}, 0.05); }
        .compaction-header-row { display: flex; align-items: center; gap: 8px; }
        .compaction-toggle { color: ${colors.borderAccent}; font-size: 10px; transition: transform 0.2s; }
        .compaction-container.expanded .compaction-toggle { transform: rotate(90deg); }
        .compaction-title { color: ${colors.text}; font-weight: bold; }
        .compaction-hint { color: ${colors.dim}; font-size: 11px; }
        .compaction-content { display: none; padding: 0 16px 16px 16px; }
        .compaction-container.expanded .compaction-content { display: block; }
        .compaction-summary { background: rgba(0, 0, 0, 0.1); border-radius: 4px; padding: 12px; }
        .compaction-summary-header { font-weight: bold; color: ${colors.borderAccent}; margin-bottom: 8px; font-size: 11px; }
        .compaction-summary-content { color: ${colors.text}; white-space: pre-wrap; word-wrap: break-word; }
        .tool-execution { padding: 12px 16px; border-radius: 4px; margin-top: 8px; }
        .tool-execution.user-bash { background: ${userBashBg}; }
        .tool-execution.user-bash-error { background: ${userBashErrorBg}; }
        .tool-header, .tool-name { font-weight: bold; }
        .tool-path { color: ${colors.borderAccent}; word-break: break-all; }
        .line-numbers { color: ${colors.warning}; }
        .line-count { color: ${colors.dim}; }
        .tool-command { font-weight: bold; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; }
        .tool-output {
            margin-top: 12px;
            color: ${colors.toolOutput};
            white-space: pre-wrap;
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-word;
            font-family: inherit;
            overflow-x: auto;
        }
        .tool-output > div { line-height: 1.4; }
        .tool-output pre { margin: 0; font-family: inherit; color: inherit; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .tool-output.expandable { cursor: pointer; }
        .tool-output.expandable:hover { opacity: 0.9; }
        .tool-output.expandable .output-full { display: none; }
        .tool-output.expandable.expanded .output-preview { display: none; }
        .tool-output.expandable.expanded .output-full { display: block; }
        .expand-hint { color: ${colors.borderAccent}; font-style: italic; margin-top: 4px; }
        .system-prompt, .tools-list { background: ${systemPromptBg}; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; }
        .system-prompt-header, .tools-header { font-weight: bold; color: ${colors.warning}; margin-bottom: 8px; }
        .system-prompt-content, .tools-content { color: ${colors.dim}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; font-size: 11px; }
        .tool-item { margin: 4px 0; }
        .tool-item-name { font-weight: bold; color: ${colors.text}; }
        .tool-diff { margin-top: 12px; font-size: 11px; font-family: inherit; overflow-x: auto; max-width: 100%; }
        .diff-line-old { color: ${colors.toolDiffRemoved}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .diff-line-new { color: ${colors.toolDiffAdded}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .diff-line-context { color: ${colors.toolDiffContext}; white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
        .error-text { color: ${colors.error}; padding: 12px 16px; }
        .bash-status.warning { color: ${colors.warning}; }
        .bash-status.error { color: ${colors.error}; }
        .bash-truncation.warning { color: ${colors.warning}; }
        .footer { margin-top: 48px; padding: 20px; text-align: center; color: ${colors.dim}; font-size: 10px; }
        .streaming-notice { background: ${streamingNoticeBg}; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; color: ${colors.dim}; font-size: 11px; }

        /* Image styles */
        .message-images { margin-bottom: 12px; }
        .message-image { max-width: 100%; max-height: 400px; border-radius: 4px; margin: 4px 0; }

        /* Markdown styles */
        .markdown-content h1, .markdown-content h2, .markdown-content h3,
        .markdown-content h4, .markdown-content h5, .markdown-content h6 {
            color: ${colors.mdHeading};
            margin: 1em 0 0.5em 0;
            font-weight: bold;
        }
        .markdown-content h1 { font-size: 1.4em; text-decoration: underline; }
        .markdown-content h2 { font-size: 1.2em; }
        .markdown-content h3 { font-size: 1.1em; }
        .markdown-content p { margin: 0.5em 0; }
        .markdown-content a { color: ${colors.mdLink}; text-decoration: underline; }
        .markdown-content a:hover { opacity: 0.8; }
        .markdown-content code {
            background: rgba(${isLight ? "0, 0, 0" : "255, 255, 255"}, 0.1);
            color: ${colors.mdCode};
            padding: 2px 6px;
            border-radius: 3px;
            font-family: inherit;
        }
        .markdown-content pre {
            background: transparent;
            border: none;
            border-radius: 0;
            padding: 0;
            margin: 0.5em 0;
            overflow-x: auto;
        }
        .markdown-content pre code {
            display: block;
            background: none;
            color: ${colors.mdCodeBlock};
            padding: 8px 12px;
        }
        .code-block-wrapper {
            margin: 0.5em 0;
        }
        .code-block-header {
            color: ${colors.mdCodeBlockBorder};
            font-size: 11px;
        }
        .code-block-footer {
            color: ${colors.mdCodeBlockBorder};
            font-size: 11px;
        }
        .markdown-content blockquote {
            border-left: 3px solid ${colors.mdQuoteBorder};
            padding-left: 12px;
            margin: 0.5em 0;
            color: ${colors.mdQuote};
            font-style: italic;
        }
        .markdown-content ul, .markdown-content ol {
            margin: 0.5em 0;
            padding-left: 24px;
        }
        .markdown-content li { margin: 0.25em 0; }
        .markdown-content li::marker { color: ${colors.mdListBullet}; }
        .markdown-content hr {
            border: none;
            border-top: 1px solid ${colors.mdHr};
            margin: 1em 0;
        }
        .markdown-content table {
            border-collapse: collapse;
            margin: 0.5em 0;
            width: 100%;
        }
        .markdown-content th, .markdown-content td {
            border: 1px solid ${colors.mdCodeBlockBorder};
            padding: 6px 10px;
            text-align: left;
        }
        .markdown-content th {
            background: rgba(${isLight ? "0, 0, 0" : "255, 255, 255"}, 0.05);
            font-weight: bold;
        }
        .markdown-content img {
            max-width: 100%;
            border-radius: 4px;
        }

        /* Syntax highlighting (highlight.js) */
        .hljs { background: transparent; }
        .hljs-comment, .hljs-quote { color: ${colors.syntaxComment}; }
        .hljs-keyword, .hljs-selector-tag, .hljs-addition { color: ${colors.syntaxKeyword}; }
        .hljs-number, .hljs-literal, .hljs-symbol, .hljs-bullet { color: ${colors.syntaxNumber}; }
        .hljs-string, .hljs-doctag, .hljs-regexp { color: ${colors.syntaxString}; }
        .hljs-title, .hljs-section, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: ${colors.syntaxFunction}; }
        .hljs-type, .hljs-class, .hljs-built_in { color: ${colors.syntaxType}; }
        .hljs-attr, .hljs-variable, .hljs-template-variable, .hljs-params { color: ${colors.syntaxVariable}; }
        .hljs-attribute { color: ${colors.syntaxVariable}; }
        .hljs-meta { color: ${colors.syntaxKeyword}; }
        .hljs-formula { background: rgba(${isLight ? "0, 0, 0" : "255, 255, 255"}, 0.05); }
        .hljs-deletion { color: ${colors.toolDiffRemoved}; }
        .hljs-emphasis { font-style: italic; }
        .hljs-strong { font-weight: bold; }
        .hljs-link { color: ${colors.mdLink}; text-decoration: underline; }

        @media print { body { background: white; color: black; } .tool-execution { border: 1px solid #ddd; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${APP_NAME} v${VERSION}</h1>
            <div class="header-info">
                <div class="info-item"><span class="info-label">Session:</span><span class="info-value">${escapeHtml(data.sessionId)}</span></div>
                <div class="info-item"><span class="info-label">Date:</span><span class="info-value">${new Date(data.timestamp).toLocaleString()}</span></div>
                <div class="info-item"><span class="info-label">Models:</span><span class="info-value">${
							Array.from(data.modelsUsed)
								.map((m) => escapeHtml(m))
								.join(", ") || "unknown"
						}</span></div>
            </div>
        </div>

        <div class="header">
            <h1>Messages</h1>
            <div class="header-info">
                <div class="info-item"><span class="info-label">User:</span><span class="info-value">${userMessages}</span></div>
                <div class="info-item"><span class="info-label">Assistant:</span><span class="info-value">${assistantMessages}</span></div>
                <div class="info-item"><span class="info-label">Tool Calls:</span><span class="info-value">${toolCallsCount}</span></div>
            </div>
        </div>

        <div class="header">
            <h1>Tokens & Cost</h1>
            <div class="header-info">
                <div class="info-item"><span class="info-label">Input:</span><span class="info-value">${data.tokenStats.input.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Output:</span><span class="info-value">${data.tokenStats.output.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Cache Read:</span><span class="info-value">${data.tokenStats.cacheRead.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Cache Write:</span><span class="info-value">${data.tokenStats.cacheWrite.toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Total:</span><span class="info-value">${(data.tokenStats.input + data.tokenStats.output + data.tokenStats.cacheRead + data.tokenStats.cacheWrite).toLocaleString()} tokens</span></div>
                <div class="info-item"><span class="info-label">Input Cost:</span><span class="info-value cost">$${data.costStats.input.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Output Cost:</span><span class="info-value cost">$${data.costStats.output.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Cache Read Cost:</span><span class="info-value cost">$${data.costStats.cacheRead.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Cache Write Cost:</span><span class="info-value cost">$${data.costStats.cacheWrite.toFixed(4)}</span></div>
                <div class="info-item"><span class="info-label">Total Cost:</span><span class="info-value cost"><strong>$${(data.costStats.input + data.costStats.output + data.costStats.cacheRead + data.costStats.cacheWrite).toFixed(4)}</strong></span></div>
                <div class="info-item"><span class="info-label">Context Usage:</span><span class="info-value">${contextUsageText}</span></div>
            </div>
        </div>

        ${systemPromptHtml}
        ${toolsHtml}
        ${streamingNotice}

        <div class="messages">
            ${messagesHtml}
        </div>

        <div class="footer">
            Generated by ${APP_NAME} coding-agent on ${new Date().toLocaleString()}
        </div>
    </div>
</body>
</html>`;
}

// ============================================================================
// Public API
// ============================================================================

export interface ExportOptions {
	outputPath?: string;
	themeName?: string;
}

/**
 * Export session to HTML using SessionManager and AgentState.
 * Used by TUI's /export command.
 * @param sessionManager The session manager
 * @param state The agent state
 * @param options Export options including output path and theme name
 */
export function exportSessionToHtml(
	sessionManager: SessionManager,
	state: AgentState,
	options?: ExportOptions | string,
): string {
	// Handle backwards compatibility: options can be just the output path string
	const opts: ExportOptions = typeof options === "string" ? { outputPath: options } : options || {};

	const sessionFile = sessionManager.getSessionFile();
	const content = readFileSync(sessionFile, "utf8");
	const data = parseSessionFile(content);

	// Enrich with data from AgentState (tools, context window)
	data.tools = state.tools.map((t: { name: string; description: string }) => ({
		name: t.name,
		description: t.description,
	}));
	data.contextWindow = state.model?.contextWindow;
	if (!data.systemPrompt) {
		data.systemPrompt = state.systemPrompt;
	}

	let outputPath = opts.outputPath;
	if (!outputPath) {
		const sessionBasename = basename(sessionFile, ".jsonl");
		outputPath = `${APP_NAME}-session-${sessionBasename}.html`;
	}

	const colors = getThemeColors(opts.themeName);
	const isLight = isLightTheme(opts.themeName);
	const html = generateHtml(data, basename(sessionFile), colors, isLight);
	writeFileSync(outputPath, html, "utf8");
	return outputPath;
}

/**
 * Export session file to HTML (standalone, without AgentState).
 * Auto-detects format: session manager format or streaming event format.
 * Used by CLI for exporting arbitrary session files.
 * @param inputPath Path to the session file
 * @param options Export options including output path and theme name
 */
export function exportFromFile(inputPath: string, options?: ExportOptions | string): string {
	// Handle backwards compatibility: options can be just the output path string
	const opts: ExportOptions = typeof options === "string" ? { outputPath: options } : options || {};

	if (!existsSync(inputPath)) {
		throw new Error(`File not found: ${inputPath}`);
	}

	const content = readFileSync(inputPath, "utf8");
	const data = parseSessionFile(content);

	let outputPath = opts.outputPath;
	if (!outputPath) {
		const inputBasename = basename(inputPath, ".jsonl");
		outputPath = `${APP_NAME}-session-${inputBasename}.html`;
	}

	const colors = getThemeColors(opts.themeName);
	const isLight = isLightTheme(opts.themeName);
	const html = generateHtml(data, basename(inputPath), colors, isLight);
	writeFileSync(outputPath, html, "utf8");
	return outputPath;
}
