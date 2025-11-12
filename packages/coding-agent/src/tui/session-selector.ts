import { type Component, Container, Spacer, Text, visibleWidth } from "@mariozechner/pi-tui";
import chalk from "chalk";
import type { SessionManager } from "../session-manager.js";

/**
 * Dynamic border component that adjusts to viewport width
 */
class DynamicBorder implements Component {
	render(width: number): string[] {
		return [chalk.blue("─".repeat(Math.max(1, width)))];
	}
}

interface SessionItem {
	path: string;
	id: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
}

/**
 * Custom session list component with multi-line items
 */
class SessionList implements Component {
	private sessions: SessionItem[] = [];
	private selectedIndex: number = 0;
	public onSelect?: (sessionPath: string) => void;
	public onCancel?: () => void;

	constructor(sessions: SessionItem[]) {
		this.sessions = sessions;
	}

	render(width: number): string[] {
		const lines: string[] = [];

		if (this.sessions.length === 0) {
			lines.push(chalk.gray("  No sessions found"));
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

		// Render each session (2 lines per session)
		for (let i = 0; i < this.sessions.length; i++) {
			const session = this.sessions[i];
			const isSelected = i === this.selectedIndex;

			// Normalize first message to single line
			const normalizedMessage = session.firstMessage.replace(/\n/g, " ").trim();

			// First line: cursor + message
			const cursor = isSelected ? chalk.blue("› ") : "  ";
			const maxMsgWidth = width - 2; // Account for cursor
			const truncatedMsg = normalizedMessage.substring(0, maxMsgWidth);
			const messageLine = cursor + (isSelected ? chalk.bold(truncatedMsg) : truncatedMsg);

			// Second line: metadata (dimmed)
			const modified = formatDate(session.modified);
			const msgCount = `${session.messageCount} message${session.messageCount !== 1 ? "s" : ""}`;
			const metadata = `  ${modified} · ${msgCount}`;
			const metadataLine = chalk.dim(metadata);

			lines.push(messageLine);
			lines.push(metadataLine);
		}

		return lines;
	}

	handleInput(keyData: string): void {
		// Up arrow
		if (keyData === "\x1b[A") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		}
		// Down arrow
		else if (keyData === "\x1b[B") {
			this.selectedIndex = Math.min(this.sessions.length - 1, this.selectedIndex + 1);
		}
		// Enter
		else if (keyData === "\r") {
			const selected = this.sessions[this.selectedIndex];
			if (selected && this.onSelect) {
				this.onSelect(selected.path);
			}
		}
		// Escape or Ctrl+C
		else if (keyData === "\x1b" || keyData === "\x03") {
			if (this.onCancel) {
				this.onCancel();
			}
		}
	}
}

/**
 * Component that renders a session selector
 */
export class SessionSelectorComponent extends Container {
	private sessionList: SessionList;

	constructor(sessionManager: SessionManager, onSelect: (sessionPath: string) => void, onCancel: () => void) {
		super();

		// Load all sessions
		const sessions = sessionManager.loadAllSessions();

		// Add header
		this.addChild(new Spacer(1));
		this.addChild(new Text(chalk.bold("Resume Session"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Create session list
		this.sessionList = new SessionList(sessions);
		this.sessionList.onSelect = onSelect;
		this.sessionList.onCancel = onCancel;

		this.addChild(this.sessionList);

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
