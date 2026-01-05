import { execFileSync } from "node:child_process";
import { arch, release, type } from "node:os";

const DEFAULT_CODEX_ORIGINATOR = "codex_cli_rs";
const CODEX_ORIGINATOR_OVERRIDE_ENV = "CODEX_INTERNAL_ORIGINATOR_OVERRIDE";
const CODEX_CLI_VERSION = "0.0.0";

type TerminalName =
	| "AppleTerminal"
	| "Ghostty"
	| "Iterm2"
	| "WarpTerminal"
	| "VsCode"
	| "WezTerm"
	| "Kitty"
	| "Alacritty"
	| "Konsole"
	| "GnomeTerminal"
	| "Vte"
	| "WindowsTerminal"
	| "Unknown";

interface TerminalInfo {
	name: TerminalName;
	termProgram?: string;
	version?: string;
	term?: string;
}

interface TmuxClientInfo {
	termtype?: string;
	termname?: string;
}

function getEnvValue(name: string): string | undefined {
	const value = process.env[name];
	if (!value) return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeHeaderToken(value: string): string {
	let sanitized = "";
	for (const ch of value) {
		const isValid = /[A-Za-z0-9\-_./]/.test(ch);
		sanitized += isValid ? ch : "_";
	}
	return sanitized;
}

function sanitizeUserAgent(value: string): string {
	let sanitized = "";
	for (const ch of value) {
		const code = ch.charCodeAt(0);
		sanitized += code >= 0x20 && code <= 0x7e ? ch : "_";
	}
	return sanitized;
}

function terminalNameFromTermProgram(value: string): TerminalName | undefined {
	const normalized = value
		.trim()
		.replace(/[ \-_.]/g, "")
		.toLowerCase();
	switch (normalized) {
		case "appleterminal":
			return "AppleTerminal";
		case "ghostty":
			return "Ghostty";
		case "iterm":
		case "iterm2":
		case "itermapp":
			return "Iterm2";
		case "warp":
		case "warpterminal":
			return "WarpTerminal";
		case "vscode":
			return "VsCode";
		case "wezterm":
			return "WezTerm";
		case "kitty":
			return "Kitty";
		case "alacritty":
			return "Alacritty";
		case "konsole":
			return "Konsole";
		case "gnometerminal":
			return "GnomeTerminal";
		case "vte":
			return "Vte";
		case "windowsterminal":
			return "WindowsTerminal";
		default:
			return undefined;
	}
}

function splitTermProgramAndVersion(value: string): { program: string; version?: string } {
	const parts = value.trim().split(/\s+/);
	return { program: parts[0] ?? "", version: parts[1] };
}

function tmuxDisplayMessage(format: string): string | undefined {
	try {
		const output = execFileSync("tmux", ["display-message", "-p", format], {
			stdio: ["ignore", "pipe", "ignore"],
		});
		const value = output.toString().trim();
		return value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

function getTmuxClientInfo(): TmuxClientInfo {
	return {
		termtype: tmuxDisplayMessage("#{client_termtype}"),
		termname: tmuxDisplayMessage("#{client_termname}"),
	};
}

function isTmuxTermProgram(value: string): boolean {
	return value.trim().toLowerCase() === "tmux";
}

function detectTerminalInfo(): TerminalInfo {
	const termProgram = getEnvValue("TERM_PROGRAM");
	const termProgramVersion = getEnvValue("TERM_PROGRAM_VERSION");
	const hasTmux = Boolean(getEnvValue("TMUX") || getEnvValue("TMUX_PANE"));
	const termValue = getEnvValue("TERM");

	if (termProgram) {
		if (isTmuxTermProgram(termProgram) && hasTmux) {
			const tmuxInfo = getTmuxClientInfo();
			if (tmuxInfo.termtype) {
				const { program, version } = splitTermProgramAndVersion(tmuxInfo.termtype);
				return {
					name: terminalNameFromTermProgram(program) ?? "Unknown",
					termProgram: program,
					version,
					term: tmuxInfo.termname,
				};
			}
			if (tmuxInfo.termname) {
				return { name: "Unknown", term: tmuxInfo.termname };
			}
		}

		return {
			name: terminalNameFromTermProgram(termProgram) ?? "Unknown",
			termProgram,
			version: termProgramVersion,
		};
	}

	const weztermVersion = getEnvValue("WEZTERM_VERSION");
	if (weztermVersion !== undefined) {
		return { name: "WezTerm", version: weztermVersion };
	}

	if (getEnvValue("ITERM_SESSION_ID") || getEnvValue("ITERM_PROFILE") || getEnvValue("ITERM_PROFILE_NAME")) {
		return { name: "Iterm2" };
	}

	if (getEnvValue("TERM_SESSION_ID")) {
		return { name: "AppleTerminal" };
	}

	if (getEnvValue("KITTY_WINDOW_ID") || termValue?.includes("kitty")) {
		return { name: "Kitty" };
	}

	if (getEnvValue("ALACRITTY_SOCKET") || termValue === "alacritty") {
		return { name: "Alacritty" };
	}

	const konsoleVersion = getEnvValue("KONSOLE_VERSION");
	if (konsoleVersion !== undefined) {
		return { name: "Konsole", version: konsoleVersion };
	}

	if (getEnvValue("GNOME_TERMINAL_SCREEN")) {
		return { name: "GnomeTerminal" };
	}

	const vteVersion = getEnvValue("VTE_VERSION");
	if (vteVersion !== undefined) {
		return { name: "Vte", version: vteVersion };
	}

	if (getEnvValue("WT_SESSION")) {
		return { name: "WindowsTerminal" };
	}

	if (termValue) {
		return { name: "Unknown", term: termValue };
	}

	return { name: "Unknown" };
}

function formatTerminalVersion(name: string, version?: string): string {
	return version && version.length > 0 ? `${name}/${version}` : name;
}

function terminalUserAgentToken(info: TerminalInfo): string {
	if (info.termProgram) {
		return sanitizeHeaderToken(formatTerminalVersion(info.termProgram, info.version));
	}
	if (info.term) {
		return sanitizeHeaderToken(info.term);
	}
	switch (info.name) {
		case "AppleTerminal":
			return sanitizeHeaderToken(formatTerminalVersion("Apple_Terminal", info.version));
		case "Ghostty":
			return sanitizeHeaderToken(formatTerminalVersion("Ghostty", info.version));
		case "Iterm2":
			return sanitizeHeaderToken(formatTerminalVersion("iTerm.app", info.version));
		case "WarpTerminal":
			return sanitizeHeaderToken(formatTerminalVersion("WarpTerminal", info.version));
		case "VsCode":
			return sanitizeHeaderToken(formatTerminalVersion("vscode", info.version));
		case "WezTerm":
			return sanitizeHeaderToken(formatTerminalVersion("WezTerm", info.version));
		case "Kitty":
			return "kitty";
		case "Alacritty":
			return "Alacritty";
		case "Konsole":
			return sanitizeHeaderToken(formatTerminalVersion("Konsole", info.version));
		case "GnomeTerminal":
			return "gnome-terminal";
		case "Vte":
			return sanitizeHeaderToken(formatTerminalVersion("VTE", info.version));
		case "WindowsTerminal":
			return "WindowsTerminal";
		default:
			return "unknown";
	}
}

function osTypeName(): string {
	const raw = type();
	if (raw === "Darwin") return "Mac OS";
	if (raw === "Windows_NT") return "Windows";
	return raw;
}

export function getCodexOriginator(): string {
	const override = getEnvValue(CODEX_ORIGINATOR_OVERRIDE_ENV);
	const originator = sanitizeHeaderToken(override ?? DEFAULT_CODEX_ORIGINATOR);
	return originator.length > 0 ? originator : DEFAULT_CODEX_ORIGINATOR;
}

export function getCodexUserAgent(originatorOverride?: string): string {
	const originator = originatorOverride ?? getCodexOriginator();
	const osName = osTypeName();
	const osVersion = release();
	const osArch = arch() || "unknown";
	const terminalToken = terminalUserAgentToken(detectTerminalInfo());
	const prefix = `${originator}/${CODEX_CLI_VERSION} (${osName} ${osVersion}; ${osArch}) ${terminalToken}`;
	return sanitizeUserAgent(prefix);
}

export function buildCodexHeaders(): Record<string, string> {
	const originator = getCodexOriginator();
	const headers: Record<string, string> = {
		originator,
		"User-Agent": getCodexUserAgent(originator),
		version: CODEX_CLI_VERSION,
	};
	const organization = getEnvValue("OPENAI_ORGANIZATION");
	if (organization) {
		headers["OpenAI-Organization"] = organization;
	}
	const project = getEnvValue("OPENAI_PROJECT");
	if (project) {
		headers["OpenAI-Project"] = project;
	}
	return headers;
}
