import { type Component, Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
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
 * Component that renders a session selector
 */
export class SessionSelectorComponent extends Container {
	private selectList: SelectList;

	constructor(sessionManager: SessionManager, onSelect: (sessionPath: string) => void, onCancel: () => void) {
		super();

		// Load all sessions
		const sessions = sessionManager.loadAllSessions();

		if (sessions.length === 0) {
			this.addChild(new DynamicBorder());
			this.addChild(new Text(chalk.gray("  No previous sessions found"), 0, 0));
			this.addChild(new DynamicBorder());
			this.selectList = new SelectList([], 0);
			this.addChild(this.selectList);

			// Auto-cancel if no sessions
			setTimeout(() => onCancel(), 100);
			return;
		}

		// Format sessions as select items
		const items: SelectItem[] = sessions.map((session) => {
			// Format dates
			const formatDate = (date: Date): string => {
				const now = new Date();
				const diffMs = now.getTime() - date.getTime();
				const diffMins = Math.floor(diffMs / 60000);
				const diffHours = Math.floor(diffMs / 3600000);
				const diffDays = Math.floor(diffMs / 86400000);

				if (diffMins < 1) return "just now";
				if (diffMins < 60) return `${diffMins}m ago`;
				if (diffHours < 24) return `${diffHours}h ago`;
				if (diffDays === 1) return "yesterday";
				if (diffDays < 7) return `${diffDays}d ago`;

				// Fallback to date string
				return date.toLocaleDateString();
			};

			// Truncate first message to single line
			const truncatedMessage = session.firstMessage.replace(/\n/g, " ").trim();

			// Build description with metadata
			const created = formatDate(session.created);
			const modified = formatDate(session.modified);
			const msgCount = `${session.messageCount} msg${session.messageCount !== 1 ? "s" : ""}`;

			const description = `${truncatedMessage}\n${chalk.dim(`Created: ${created} • Modified: ${modified} • ${msgCount}`)}`;

			return {
				value: session.path,
				label: truncatedMessage.substring(0, 80),
				description,
			};
		});

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Text(chalk.bold("Select a session to resume:"), 1, 0));

		// Create selector
		this.selectList = new SelectList(items, Math.min(10, items.length));

		this.selectList.onSelect = (item) => {
			onSelect(item.value);
		};

		this.selectList.onCancel = () => {
			onCancel();
		};

		this.addChild(this.selectList);

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.selectList;
	}
}
