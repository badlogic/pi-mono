import type { AgentState } from "@mariozechner/pi-agent-core";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { APP_NAME, getExportTemplateDir, VERSION } from "../../config.js";
import { getResolvedThemeColors, isLightTheme } from "../../modes/interactive/theme/theme.js";
import { SessionManager } from "../session-manager.js";

export interface ExportOptions {
	outputPath?: string;
	themeName?: string;
}

/**
 * Generate CSS custom property declarations from theme colors.
 */
function generateThemeVars(themeName?: string): string {
	const colors = getResolvedThemeColors(themeName);
	const lines: string[] = [];
	for (const [key, value] of Object.entries(colors)) {
		lines.push(`--${key}: ${value};`);
	}
	return lines.join("\n      ");
}

interface SessionData {
	header: ReturnType<SessionManager["getHeader"]>;
	entries: ReturnType<SessionManager["getEntries"]>;
	leafId: string | null;
	systemPrompt?: string;
	tools?: { name: string; description: string }[];
}

/**
 * Core HTML generation logic shared by both export functions.
 */
function generateHtml(sessionData: SessionData, themeName?: string): string {
	const templateDir = getExportTemplateDir();
	const template = readFileSync(join(templateDir, "template.html"), "utf-8");
	const markedJs = readFileSync(join(templateDir, "vendor", "marked.min.js"), "utf-8");
	const hljsJs = readFileSync(join(templateDir, "vendor", "highlight.min.js"), "utf-8");

	const themeVars = generateThemeVars(themeName);
	const light = isLightTheme(themeName);
	const bodyBg = light ? "#f8f8f8" : "#18181e";
	const containerBg = light ? "#ffffff" : "#1e1e24";

	const title = `Session ${sessionData.header?.id ?? "export"} - ${APP_NAME}`;

	// Base64 encode session data to avoid escaping issues
	const sessionDataBase64 = Buffer.from(JSON.stringify(sessionData)).toString("base64");

	return template
		.replace("{{TITLE}}", title)
		.replace("{{THEME_VARS}}", themeVars)
		.replace("{{BODY_BG}}", bodyBg)
		.replace("{{CONTAINER_BG}}", containerBg)
		.replace("{{SESSION_DATA}}", sessionDataBase64)
		.replace("{{MARKED_JS}}", markedJs)
		.replace("{{HIGHLIGHT_JS}}", hljsJs)
		.replace("{{APP_NAME}}", `${APP_NAME} v${VERSION}`)
		.replace("{{GENERATED_DATE}}", new Date().toLocaleString());
}

/**
 * Export session to HTML using SessionManager and AgentState.
 * Used by TUI's /export command.
 */
export function exportSessionToHtml(sm: SessionManager, state?: AgentState, options?: ExportOptions | string): string {
	const opts: ExportOptions = typeof options === "string" ? { outputPath: options } : options || {};

	const sessionFile = sm.getSessionFile();
	if (!sessionFile) {
		throw new Error("Cannot export in-memory session to HTML");
	}
	if (!existsSync(sessionFile)) {
		throw new Error("Nothing to export yet - start a conversation first");
	}

	const sessionData: SessionData = {
		header: sm.getHeader(),
		entries: sm.getEntries(),
		leafId: sm.getLeafId(),
		systemPrompt: state?.systemPrompt,
		tools: state?.tools?.map((t) => ({ name: t.name, description: t.description })),
	};

	const html = generateHtml(sessionData, opts.themeName);

	let outputPath = opts.outputPath;
	if (!outputPath) {
		const sessionBasename = basename(sessionFile, ".jsonl");
		outputPath = `${APP_NAME}-session-${sessionBasename}.html`;
	}

	writeFileSync(outputPath, html, "utf8");
	return outputPath;
}

/**
 * Export session file to HTML (standalone, without AgentState).
 * Used by CLI for exporting arbitrary session files.
 */
export function exportFromFile(inputPath: string, options?: ExportOptions | string): string {
	const opts: ExportOptions = typeof options === "string" ? { outputPath: options } : options || {};

	if (!existsSync(inputPath)) {
		throw new Error(`File not found: ${inputPath}`);
	}

	const sm = SessionManager.open(inputPath);

	const sessionData: SessionData = {
		header: sm.getHeader(),
		entries: sm.getEntries(),
		leafId: sm.getLeafId(),
		systemPrompt: undefined,
		tools: undefined,
	};

	const html = generateHtml(sessionData, opts.themeName);

	let outputPath = opts.outputPath;
	if (!outputPath) {
		const inputBasename = basename(inputPath, ".jsonl");
		outputPath = `${APP_NAME}-session-${inputBasename}.html`;
	}

	writeFileSync(outputPath, html, "utf8");
	return outputPath;
}
