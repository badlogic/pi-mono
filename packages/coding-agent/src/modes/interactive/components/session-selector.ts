import {
	type Component,
	Container,
	getEditorKeybindings,
	Input,
	Spacer,
	SplitPane,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import type { SessionInfo } from "../../../core/session-manager.js";
import { fuzzyFilter } from "../../../utils/fuzzy.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

// Box drawing characters
const BOX = {
	topLeft: "┌",
	topRight: "┐",
	bottomLeft: "└",
	bottomRight: "┘",
	horizontal: "─",
	vertical: "│",
};

const MAX_LINES_PER_MSG = 3; // Maximum number of lines to show for each message

/** Splits a string into lines, truncating each to the given width. Returns at most MAX_LINES_PER_MSG lines. */
function splitIntoChunks(str: string, width: number): string[] {
	const result: string[] = [];
	for (let line of str.split("\n")) {
		line = line.trim();
		if (line.length > 0) {
			result.push(truncateToWidth(line, width));
		}
		if (result.length >= MAX_LINES_PER_MSG) {
			break;
		}
	}
	return result;
}

const PREVIEW_BOX_PAD = "  "; // Left and right padding for the preview box

/**
 * Preview component showing a session's messages in a bordered box.
 * Truncates conversation in the middle, showing beginning and end.
 */
class SessionPreview implements Component {
	private session: SessionInfo | null = null;
	private maxLines: number;

	constructor(maxLines: number = 12) {
		this.maxLines = maxLines;
	}

	setSession(session: SessionInfo | null): void {
		this.session = session;
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (!this.session) {
			return [theme.fg("muted", "No session selected")];
		}

		const innerWidth = width - 2; // Account for left/right borders
		const contentWidth = innerWidth - PREVIEW_BOX_PAD.length * 2; // Account for padding on each side

		// Extract messages from session entries
		const messageEntries = this.session.entries.filter((e) => e.type === "message");

		// List of message entries with prefix and upto MAX_LINES_PER_MSG truncated lines
		const content: { prefix: string; lines: string[] }[] = [];
		for (const { message } of messageEntries) {
			let prefix: string, suffix: string;
			if (message.role === "bashExecution") {
				prefix = "bash";
				suffix = message.command;
			} else if (message.role === "toolResult") {
				prefix = message.toolName;
				suffix = message.content.map((c) => (c.type === "text" ? c.text : "")).join("");
			} else {
				prefix = message.role === "assistant" ? "  ai" : "user";
				suffix =
					typeof message.content === "string"
						? message.content
						: message.content.map((c) => (c.type === "text" ? c.text : "")).join("");
			}

			prefix = `${theme.bold(prefix)} `;
			const suffixParts = splitIntoChunks(suffix, contentWidth - prefix.length);
			content.push({ prefix, lines: suffixParts });
		}

		// Apply middle truncation if needed
		const displayLines = this.truncateMiddle(content, this.maxLines, contentWidth);

		// Build the box
		const result: string[] = [];

		result.push(BOX.topLeft + BOX.horizontal.repeat(innerWidth) + BOX.topRight); // Top border
		result.push(BOX.vertical + " ".repeat(innerWidth) + BOX.vertical); // Empty line at top

		// Content lines with padding
		for (const line of displayLines) {
			const extraPadding = Math.max(0, contentWidth - visibleWidth(line));
			result.push(BOX.vertical + PREVIEW_BOX_PAD + line + " ".repeat(extraPadding) + PREVIEW_BOX_PAD + BOX.vertical);
		}

		result.push(BOX.vertical + " ".repeat(innerWidth) + BOX.vertical); // Empty line at bottom
		result.push(BOX.bottomLeft + BOX.horizontal.repeat(innerWidth) + BOX.bottomRight); // Bottom border

		return result;
	}

	/**
	 * Truncate content in the middle, showing beginning and end with separator.
	 * Top half lines are truncated at end, bottom half lines are truncated at start.
	 */
	private truncateMiddle(content: { prefix: string; lines: string[] }[], maxLines: number, width: number): string[] {
		let start = 0;
		let end = content.length - 1;
		const top: string[] = [];
		const bottom: string[] = [];
		const EMPTY_PREFIX = " ".repeat(5);

		// Create centered separator
		const ellipsis = "   ⋮   ";
		const barLength = Math.floor((width - ellipsis.length) / 2);
		const fullSeparator = theme.fg("muted", "~".repeat(barLength) + ellipsis + "~".repeat(barLength));
		const partialSeparator = theme.fg("muted", " ".repeat(barLength) + ellipsis + " ".repeat(barLength));

		// Alternately take messages from start and end of content array,
		// building top and bottom sections until we hit maxLines limit.
		while (start < end && top.length + bottom.length < maxLines) {
			content[start].lines.slice(0, MAX_LINES_PER_MSG).forEach((line, i) => {
				const prefix = i === 0 ? content[start].prefix : EMPTY_PREFIX;
				top.push(truncateToWidth(prefix + line, width));
			});
			if (content[start].lines.length > MAX_LINES_PER_MSG) {
				top.push(partialSeparator);
			}
			if (content[end].lines.length > MAX_LINES_PER_MSG) {
				bottom.push(partialSeparator);
			}
			content[end].lines.slice(-MAX_LINES_PER_MSG).forEach((line, i) => {
				const prefix = i === 0 ? content[end].prefix : EMPTY_PREFIX;
				bottom.push(truncateToWidth(prefix + line, width));
			});
			start++;
			end--;
		}

		return [...top, fullSeparator, ...bottom];
	}
}

/**
 * Custom session list component with multi-line items and search
 */
class SessionList implements Component {
	private allSessions: SessionInfo[] = [];
	private filteredSessions: SessionInfo[] = [];
	private selectedIndex: number = 0;
	private searchInput: Input;
	public onSelect?: (sessionPath: string) => void;
	public onCancel?: () => void;
	public onExit: () => void = () => {};
	public onSelectionChange?: (session: SessionInfo) => void;
	private maxVisible: number = 8; // Max sessions visible (each session is 3 lines: msg + metadata + blank)

	constructor(sessions: SessionInfo[]) {
		this.allSessions = sessions;
		this.filteredSessions = sessions;
		this.searchInput = new Input();

		// Handle Enter in search input - select current item
		this.searchInput.onSubmit = () => {
			if (this.filteredSessions[this.selectedIndex]) {
				const selected = this.filteredSessions[this.selectedIndex];
				if (this.onSelect) {
					this.onSelect(selected.path);
				}
			}
		};
	}

	private filterSessions(query: string): void {
		this.filteredSessions = fuzzyFilter(
			this.allSessions,
			query,
			(session) => `${session.id} ${session.allMessagesText}`,
		);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredSessions.length - 1));
		this.notifySelectionChange();
	}

	private notifySelectionChange(): void {
		const selectedSession = this.filteredSessions[this.selectedIndex];
		if (selectedSession && this.onSelectionChange) {
			this.onSelectionChange(selectedSession);
		}
	}

	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(width: number): string[] {
		const lines: string[] = [];

		// Render search input
		lines.push(...this.searchInput.render(width));
		lines.push(""); // Blank line after search

		if (this.filteredSessions.length === 0) {
			lines.push(theme.fg("muted", "  No sessions found"));
			return lines;
		}

		// Format dates
		const formatDate = (date: Date): string => {
			const now = new Date();
			const diffMs = now.getTime() - date.getTime();
			const diffMins = Math.floor(diffMs / 60000);
			const diffHours = Math.floor(diffMs / 3600000);
			const diffDays = Math.floor(diffMs / 86400000);

			if (diffMins < 1) return "just now";
			if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
			if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
			if (diffDays === 1) return "1 day ago";
			if (diffDays < 7) return `${diffDays} days ago`;

			return date.toLocaleDateString();
		};

		// Calculate visible range with scrolling
		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredSessions.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredSessions.length);

		// Render visible sessions (2 lines per session + blank line)
		for (let i = startIndex; i < endIndex; i++) {
			const session = this.filteredSessions[i];
			const isSelected = i === this.selectedIndex;

			// Normalize first message to single line
			const normalizedMessage = session.firstMessage.replace(/\n/g, " ").trim();

			// First line: cursor + message (truncate to visible width)
			const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
			const maxMsgWidth = width - 2; // Account for cursor (2 visible chars)
			const truncatedMsg = truncateToWidth(normalizedMessage, maxMsgWidth, "...");
			const messageLine = cursor + (isSelected ? theme.bold(truncatedMsg) : truncatedMsg);

			// Second line: metadata (dimmed) - also truncate for safety
			const modified = formatDate(session.modified);
			const msgCount = `${session.messageCount} message${session.messageCount !== 1 ? "s" : ""}`;
			const metadata = `  ${modified} · ${msgCount}`;
			const metadataLine = theme.fg("dim", truncateToWidth(metadata, width, ""));

			lines.push(messageLine);
			lines.push(metadataLine);
			lines.push(""); // Blank line between sessions
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < this.filteredSessions.length) {
			const scrollText = `  (${this.selectedIndex + 1}/${this.filteredSessions.length})`;
			const scrollInfo = theme.fg("muted", truncateToWidth(scrollText, width, ""));
			lines.push(scrollInfo);
		}

		return lines;
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		// Up arrow
		if (kb.matches(keyData, "selectUp")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.notifySelectionChange();
		}
		// Down arrow
		else if (kb.matches(keyData, "selectDown")) {
			this.selectedIndex = Math.min(this.filteredSessions.length - 1, this.selectedIndex + 1);
			this.notifySelectionChange();
		}
		// Enter
		else if (kb.matches(keyData, "selectConfirm")) {
			const selected = this.filteredSessions[this.selectedIndex];
			if (selected && this.onSelect) {
				this.onSelect(selected.path);
			}
		}
		// Escape - cancel
		else if (kb.matches(keyData, "selectCancel")) {
			if (this.onCancel) {
				this.onCancel();
			}
		}
		// Pass everything else to search input
		else {
			this.searchInput.handleInput(keyData);
			this.filterSessions(this.searchInput.getValue());
		}
	}
}

/**
 * Component that renders a session selector
 */
export class SessionSelectorComponent extends Container {
	private sessionList: SessionList;

	constructor(
		sessions: SessionInfo[],
		onSelect: (sessionPath: string) => void,
		onCancel: () => void,
		onExit: () => void,
	) {
		super();

		// Add header
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold("Resume Session"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Create session list
		this.sessionList = new SessionList(sessions);
		this.sessionList.onSelect = onSelect;
		this.sessionList.onCancel = onCancel;
		this.sessionList.onExit = onExit;

		// Create preview pane with first session as placeholder for now
		const preview = new SessionPreview(20);
		if (sessions.length > 0) {
			preview.setSession(sessions[0]);
		}

		this.sessionList.onSelectionChange = (session) => {
			preview.setSession(session);
		};

		// Create split pane with session list on left and preview on right
		const splitPane = new SplitPane(this.sessionList, preview, {
			divider: "",
			paddingX: 1,
		});
		this.addChild(splitPane);

		// Add bottom border
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		// Auto-cancel if no sessions
		if (sessions.length === 0) {
			setTimeout(() => onCancel(), 100);
		}
	}

	getSessionList(): SessionList {
		return this.sessionList;
	}
}
