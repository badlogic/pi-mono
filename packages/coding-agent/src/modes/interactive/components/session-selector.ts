import * as os from "node:os";
import {
	type Component,
	Container,
	getEditorKeybindings,
	Input,
	matchesKey,
	Spacer,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import type { SessionInfo, SessionListProgress } from "../../../core/session-manager.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { filterAndSortSessions, type SortMode } from "./session-selector-search.js";

type SessionScope = "current" | "all";

function shortenPath(path: string): string {
	const home = os.homedir();
	if (!path) return path;
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

function formatSessionDate(date: Date): string {
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
}

class SessionSelectorHeader implements Component {
	private scope: SessionScope;
	private sortMode: SortMode;
	private loading = false;
	private loadProgress: { loaded: number; total: number } | null = null;

	constructor(scope: SessionScope, sortMode: SortMode) {
		this.scope = scope;
		this.sortMode = sortMode;
	}

	setScope(scope: SessionScope): void {
		this.scope = scope;
	}

	setSortMode(sortMode: SortMode): void {
		this.sortMode = sortMode;
	}

	setLoading(loading: boolean): void {
		this.loading = loading;
		if (!loading) {
			this.loadProgress = null;
		}
	}

	setProgress(loaded: number, total: number): void {
		this.loadProgress = { loaded, total };
	}

	invalidate(): void {}

	render(width: number): string[] {
		const title = this.scope === "current" ? "Resume Session (Current Folder)" : "Resume Session (All)";
		const leftText = theme.bold(title);

		const sortLabel = this.sortMode === "recent" ? "Recent" : "Fuzzy";
		const sortText = theme.fg("muted", "Sort: ") + theme.fg("accent", sortLabel);

		let scopeText: string;
		if (this.loading) {
			const progressText = this.loadProgress ? `${this.loadProgress.loaded}/${this.loadProgress.total}` : "...";
			scopeText = `${theme.fg("muted", "○ Current Folder | ")}${theme.fg("accent", `Loading ${progressText}`)}`;
		} else {
			scopeText =
				this.scope === "current"
					? `${theme.fg("accent", "◉ Current Folder")}${theme.fg("muted", " | ○ All")}`
					: `${theme.fg("muted", "○ Current Folder | ")}${theme.fg("accent", "◉ All")}`;
		}

		const rightText = truncateToWidth(`${scopeText}  ${sortText}`, width, "");
		const availableLeft = Math.max(0, width - visibleWidth(rightText) - 1);
		const left = truncateToWidth(leftText, availableLeft, "");
		const spacing = Math.max(0, width - visibleWidth(left) - visibleWidth(rightText));
		const hintText = 'Tab: scope · Ctrl+R: sort · re:<pattern> for regex · "phrase" for exact phrase';
		const truncatedHint = truncateToWidth(hintText, width, "…");
		const hint = theme.fg("muted", truncatedHint);
		return [`${left}${" ".repeat(spacing)}${rightText}`, hint];
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
	private showCwd = false;
	private sortMode: SortMode = "relevance";
	public onSelect?: (sessionPath: string) => void;
	public onCancel?: () => void;
	public onExit: () => void = () => {};
	public onToggleScope?: () => void;
	public onToggleSort?: () => void;
	private maxVisible: number = 5; // Max sessions visible (each session is 3 lines: msg + metadata + blank)

	constructor(sessions: SessionInfo[], showCwd: boolean, sortMode: SortMode) {
		this.allSessions = sessions;
		this.filteredSessions = sessions;
		this.searchInput = new Input();
		this.showCwd = showCwd;
		this.sortMode = sortMode;

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

	setSortMode(sortMode: SortMode): void {
		this.sortMode = sortMode;
		this.filterSessions(this.searchInput.getValue());
	}

	setSessions(sessions: SessionInfo[], showCwd: boolean): void {
		this.allSessions = sessions;
		this.showCwd = showCwd;
		this.filterSessions(this.searchInput.getValue());
	}

	private filterSessions(query: string): void {
		this.filteredSessions = filterAndSortSessions(this.allSessions, query, this.sortMode);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredSessions.length - 1));
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];

		// Render search input
		lines.push(...this.searchInput.render(width));
		lines.push(""); // Blank line after search

		if (this.filteredSessions.length === 0) {
			if (this.showCwd) {
				// "All" scope - no sessions anywhere that match filter
				lines.push(theme.fg("muted", truncateToWidth("  No sessions found", width, "…")));
			} else {
				// "Current folder" scope - hint to try "all"
				lines.push(
					theme.fg(
						"muted",
						truncateToWidth("  No sessions in current folder. Press Tab to view all.", width, "…"),
					),
				);
			}
			return lines;
		}

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

			// Use session name if set, otherwise first message
			const hasName = !!session.name;
			const displayText = session.name ?? session.firstMessage;
			const normalizedMessage = displayText.replace(/\n/g, " ").trim();

			// First line: cursor + message (truncate to visible width)
			// Use warning color for custom names to distinguish from first message
			const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
			const maxMsgWidth = width - 2; // Account for cursor (2 visible chars)
			const truncatedMsg = truncateToWidth(normalizedMessage, maxMsgWidth, "...");
			let styledMsg = truncatedMsg;
			if (hasName) {
				styledMsg = theme.fg("warning", truncatedMsg);
			}
			if (isSelected) {
				styledMsg = theme.bold(styledMsg);
			}
			const messageLine = cursor + styledMsg;

			// Second line: metadata (dimmed) - also truncate for safety
			const modified = formatSessionDate(session.modified);
			const msgCount = `${session.messageCount} message${session.messageCount !== 1 ? "s" : ""}`;
			const metadataParts = [modified, msgCount];
			if (this.showCwd && session.cwd) {
				metadataParts.push(shortenPath(session.cwd));
			}
			const metadata = `  ${metadataParts.join(" · ")}`;
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
		if (kb.matches(keyData, "tab")) {
			if (this.onToggleScope) {
				this.onToggleScope();
			}
			return;
		}

		if (matchesKey(keyData, "ctrl+r")) {
			this.onToggleSort?.();
			return;
		}

		// Up arrow
		if (kb.matches(keyData, "selectUp")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		}
		// Down arrow
		else if (kb.matches(keyData, "selectDown")) {
			this.selectedIndex = Math.min(this.filteredSessions.length - 1, this.selectedIndex + 1);
		}
		// Page up - jump up by maxVisible items
		else if (kb.matches(keyData, "selectPageUp")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - this.maxVisible);
		}
		// Page down - jump down by maxVisible items
		else if (kb.matches(keyData, "selectPageDown")) {
			this.selectedIndex = Math.min(this.filteredSessions.length - 1, this.selectedIndex + this.maxVisible);
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

type SessionsLoader = (onProgress?: SessionListProgress) => Promise<SessionInfo[]>;

/**
 * Component that renders a session selector
 */
export class SessionSelectorComponent extends Container {
	private sessionList: SessionList;
	private header: SessionSelectorHeader;
	private scope: SessionScope = "current";
	private sortMode: SortMode = "relevance";
	private currentSessions: SessionInfo[] | null = null;
	private allSessions: SessionInfo[] | null = null;
	private currentSessionsLoader: SessionsLoader;
	private allSessionsLoader: SessionsLoader;
	private onCancel: () => void;
	private requestRender: () => void;

	constructor(
		currentSessionsLoader: SessionsLoader,
		allSessionsLoader: SessionsLoader,
		onSelect: (sessionPath: string) => void,
		onCancel: () => void,
		onExit: () => void,
		requestRender: () => void,
	) {
		super();
		this.currentSessionsLoader = currentSessionsLoader;
		this.allSessionsLoader = allSessionsLoader;
		this.onCancel = onCancel;
		this.requestRender = requestRender;
		this.header = new SessionSelectorHeader(this.scope, this.sortMode);

		// Add header
		this.addChild(new Spacer(1));
		this.addChild(this.header);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Create session list (starts empty, will be populated after load)
		this.sessionList = new SessionList([], false, this.sortMode);
		this.sessionList.onSelect = onSelect;
		this.sessionList.onCancel = onCancel;
		this.sessionList.onExit = onExit;
		this.sessionList.onToggleScope = () => this.toggleScope();
		this.sessionList.onToggleSort = () => this.toggleSortMode();

		this.addChild(this.sessionList);

		// Add bottom border
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		// Start loading current sessions immediately
		this.loadCurrentSessions();
	}

	private loadCurrentSessions(): void {
		this.header.setLoading(true);
		this.requestRender();
		this.currentSessionsLoader((loaded, total) => {
			this.header.setProgress(loaded, total);
			this.requestRender();
		}).then((sessions) => {
			this.currentSessions = sessions;
			this.header.setLoading(false);
			this.sessionList.setSessions(sessions, false);
			this.requestRender();
		});
	}

	private toggleSortMode(): void {
		this.sortMode = this.sortMode === "recent" ? "relevance" : "recent";
		this.header.setSortMode(this.sortMode);
		this.sessionList.setSortMode(this.sortMode);
		this.requestRender();
	}

	private toggleScope(): void {
		if (this.scope === "current") {
			// Switching to "all" - load if not already loaded
			if (this.allSessions === null) {
				this.header.setLoading(true);
				this.header.setScope("all");
				this.sessionList.setSessions([], true); // Clear list while loading
				this.requestRender();
				// Load asynchronously with progress updates
				this.allSessionsLoader((loaded, total) => {
					this.header.setProgress(loaded, total);
					this.requestRender();
				}).then((sessions) => {
					this.allSessions = sessions;
					this.header.setLoading(false);
					this.scope = "all";
					this.sessionList.setSessions(this.allSessions, true);
					this.requestRender();
					// If no sessions in All scope either, cancel
					if (this.allSessions.length === 0 && (this.currentSessions?.length ?? 0) === 0) {
						this.onCancel();
					}
				});
			} else {
				this.scope = "all";
				this.sessionList.setSessions(this.allSessions, true);
				this.header.setScope(this.scope);
			}
		} else {
			// Switching back to "current"
			this.scope = "current";
			this.sessionList.setSessions(this.currentSessions ?? [], false);
			this.header.setScope(this.scope);
		}
	}

	getSessionList(): SessionList {
		return this.sessionList;
	}
}
