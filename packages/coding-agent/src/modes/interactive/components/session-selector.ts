import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import * as os from "node:os";
import {
	type Component,
	Container,
	type Focusable,
	getEditorKeybindings,
	Input,
	matchesKey,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import type { SessionInfo, SessionListProgress } from "../../../core/session-manager.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint } from "./keybinding-hints.js";
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
	private requestRender: () => void;
	private loading = false;
	private loadProgress: { loaded: number; total: number } | null = null;
	private showPath = false;
	private confirmingDeletePath: string | null = null;
	private statusMessage: { type: "info" | "error"; message: string } | null = null;
	private statusTimeout: ReturnType<typeof setTimeout> | null = null;
	private showRenameHint = false;

	constructor(scope: SessionScope, sortMode: SortMode, requestRender: () => void) {
		this.scope = scope;
		this.sortMode = sortMode;
		this.requestRender = requestRender;
	}

	setScope(scope: SessionScope): void {
		this.scope = scope;
	}

	setSortMode(sortMode: SortMode): void {
		this.sortMode = sortMode;
	}

	setLoading(loading: boolean): void {
		this.loading = loading;
		// Progress is scoped to the current load; clear whenever the loading state is set
		this.loadProgress = null;
	}

	setProgress(loaded: number, total: number): void {
		this.loadProgress = { loaded, total };
	}

	setShowPath(showPath: boolean): void {
		this.showPath = showPath;
	}

	setShowRenameHint(show: boolean): void {
		this.showRenameHint = show;
	}

	setConfirmingDeletePath(path: string | null): void {
		this.confirmingDeletePath = path;
	}

	private clearStatusTimeout(): void {
		if (!this.statusTimeout) return;
		clearTimeout(this.statusTimeout);
		this.statusTimeout = null;
	}

	setStatusMessage(msg: { type: "info" | "error"; message: string } | null, autoHideMs?: number): void {
		this.clearStatusTimeout();
		this.statusMessage = msg;
		if (!msg || !autoHideMs) return;

		this.statusTimeout = setTimeout(() => {
			this.statusMessage = null;
			this.statusTimeout = null;
			this.requestRender();
		}, autoHideMs);
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
		} else if (this.scope === "current") {
			scopeText = `${theme.fg("accent", "◉ Current Folder")}${theme.fg("muted", " | ○ All")}`;
		} else {
			scopeText = `${theme.fg("muted", "○ Current Folder | ")}${theme.fg("accent", "◉ All")}`;
		}

		const rightText = truncateToWidth(`${scopeText}  ${sortText}`, width, "");
		const availableLeft = Math.max(0, width - visibleWidth(rightText) - 1);
		const left = truncateToWidth(leftText, availableLeft, "");
		const spacing = Math.max(0, width - visibleWidth(left) - visibleWidth(rightText));

		// Build hint lines - changes based on state (all branches truncate to width)
		let hintLine1: string;
		let hintLine2: string;
		if (this.confirmingDeletePath !== null) {
			const confirmHint = "Delete session? [Enter] confirm · [Esc/Ctrl+C] cancel";
			hintLine1 = theme.fg("error", truncateToWidth(confirmHint, width, "…"));
			hintLine2 = "";
		} else if (this.statusMessage) {
			const color = this.statusMessage.type === "error" ? "error" : "accent";
			hintLine1 = theme.fg(color, truncateToWidth(this.statusMessage.message, width, "…"));
			hintLine2 = "";
		} else {
			const pathState = this.showPath ? "(on)" : "(off)";
			const sep = theme.fg("muted", " · ");
			const hint1 = keyHint("tab", "scope") + sep + theme.fg("muted", 're:<pattern> regex · "phrase" exact');
			const hint2Parts = [
				keyHint("toggleSessionSort", "sort"),
				keyHint("deleteSession", "delete"),
				keyHint("toggleSessionPath", `path ${pathState}`),
			];
			if (this.showRenameHint) {
				hint2Parts.push(keyHint("renameSession", "rename"));
			}
			const hint2 = hint2Parts.join(sep);
			hintLine1 = truncateToWidth(hint1, width, "…");
			hintLine2 = truncateToWidth(hint2, width, "…");
		}

		return [`${left}${" ".repeat(spacing)}${rightText}`, hintLine1, hintLine2];
	}
}

/**
 * Custom session list component with multi-line items and search
 */
class SessionList implements Component, Focusable {
	public getSelectedSessionPath(): string | undefined {
		const selected = this.filteredSessions[this.selectedIndex];
		return selected?.path;
	}
	private allSessions: SessionInfo[] = [];
	private filteredSessions: SessionInfo[] = [];
	private selectedIndex: number = 0;
	private searchInput: Input;
	private showCwd = false;
	private sortMode: SortMode = "relevance";
	private showPath = false;
	private confirmingDeletePath: string | null = null;
	private currentSessionFilePath?: string;
	public onSelect?: (sessionPath: string) => void;
	public onCancel?: () => void;
	public onExit: () => void = () => {};
	public onToggleScope?: () => void;
	public onToggleSort?: () => void;
	public onTogglePath?: (showPath: boolean) => void;
	public onDeleteConfirmationChange?: (path: string | null) => void;
	public onDeleteSession?: (sessionPath: string) => Promise<void>;
	public onRenameSession?: (sessionPath: string) => void;
	public onError?: (message: string) => void;
	private maxVisible: number = 5; // Max sessions visible (each session: message + metadata + optional path + blank)

	// Focusable implementation - propagate to searchInput for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(sessions: SessionInfo[], showCwd: boolean, sortMode: SortMode, currentSessionFilePath?: string) {
		this.allSessions = sessions;
		this.filteredSessions = sessions;
		this.searchInput = new Input();
		this.showCwd = showCwd;
		this.sortMode = sortMode;
		this.currentSessionFilePath = currentSessionFilePath;

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

	private setConfirmingDeletePath(path: string | null): void {
		this.confirmingDeletePath = path;
		this.onDeleteConfirmationChange?.(path);
	}

	private startDeleteConfirmationForSelectedSession(): void {
		const selected = this.filteredSessions[this.selectedIndex];
		if (!selected) return;

		// Prevent deleting current session
		if (this.currentSessionFilePath && selected.path === this.currentSessionFilePath) {
			this.onError?.("Cannot delete the currently active session");
			return;
		}

		this.setConfirmingDeletePath(selected.path);
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

		// Render visible sessions (message + metadata + optional path + blank line)
		for (let i = startIndex; i < endIndex; i++) {
			const session = this.filteredSessions[i];
			const isSelected = i === this.selectedIndex;
			const isConfirmingDelete = session.path === this.confirmingDeletePath;

			// Use session name if set, otherwise first message
			const hasName = !!session.name;
			const displayText = session.name ?? session.firstMessage;
			const normalizedMessage = displayText.replace(/\n/g, " ").trim();

			// First line: cursor + message (truncate to visible width)
			// Use warning color for custom names to distinguish from first message
			const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
			const maxMsgWidth = width - 2; // Account for cursor (2 visible chars)
			const truncatedMsg = truncateToWidth(normalizedMessage, maxMsgWidth, "...");
			let messageColor: "error" | "warning" | null = null;
			if (isConfirmingDelete) {
				messageColor = "error";
			} else if (hasName) {
				messageColor = "warning";
			}
			let styledMsg = messageColor ? theme.fg(messageColor, truncatedMsg) : truncatedMsg;
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
			const truncatedMetadata = truncateToWidth(metadata, width, "");
			const metadataLine = theme.fg(isConfirmingDelete ? "error" : "dim", truncatedMetadata);

			lines.push(messageLine);
			lines.push(metadataLine);

			// Optional third line: file path (when showPath is enabled)
			if (this.showPath) {
				const pathText = `  ${shortenPath(session.path)}`;
				const truncatedPath = truncateToWidth(pathText, width, "…");
				const pathLine = theme.fg(isConfirmingDelete ? "error" : "muted", truncatedPath);
				lines.push(pathLine);
			}

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

		// Handle delete confirmation state first - intercept all keys
		if (this.confirmingDeletePath !== null) {
			if (kb.matches(keyData, "selectConfirm")) {
				const pathToDelete = this.confirmingDeletePath;
				this.setConfirmingDeletePath(null);
				void this.onDeleteSession?.(pathToDelete);
				return;
			}
			// Allow both Escape and Ctrl+C to cancel (consistent with pi UX)
			if (kb.matches(keyData, "selectCancel") || matchesKey(keyData, "ctrl+c")) {
				this.setConfirmingDeletePath(null);
				return;
			}
			// Ignore all other keys while confirming
			return;
		}

		if (kb.matches(keyData, "tab")) {
			if (this.onToggleScope) {
				this.onToggleScope();
			}
			return;
		}

		if (kb.matches(keyData, "toggleSessionSort")) {
			this.onToggleSort?.();
			return;
		}

		// Ctrl+P: toggle path display
		if (kb.matches(keyData, "toggleSessionPath")) {
			this.showPath = !this.showPath;
			this.onTogglePath?.(this.showPath);
			return;
		}

		// Ctrl+D: initiate delete confirmation (useful on terminals that don't distinguish Ctrl+Backspace from Backspace)
		if (kb.matches(keyData, "deleteSession")) {
			this.startDeleteConfirmationForSelectedSession();
			return;
		}

		// Ctrl+R: rename selected session
		if (matchesKey(keyData, "ctrl+r")) {
			const selected = this.filteredSessions[this.selectedIndex];
			if (selected) {
				this.onRenameSession?.(selected.path);
			}
			return;
		}

		// Ctrl+Backspace: non-invasive convenience alias for delete
		// Only triggers deletion when the query is empty; otherwise it is forwarded to the input
		if (kb.matches(keyData, "deleteSessionNoninvasive")) {
			if (this.searchInput.getValue().length > 0) {
				this.searchInput.handleInput(keyData);
				this.filterSessions(this.searchInput.getValue());
				return;
			}

			this.startDeleteConfirmationForSelectedSession();
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
 * Delete a session file, trying the `trash` CLI first, then falling back to unlink
 */
async function deleteSessionFile(
	sessionPath: string,
): Promise<{ ok: boolean; method: "trash" | "unlink"; error?: string }> {
	// Try `trash` first (if installed)
	const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];
	const trashResult = spawnSync("trash", trashArgs, { encoding: "utf-8" });

	const getTrashErrorHint = (): string | null => {
		const parts: string[] = [];
		if (trashResult.error) {
			parts.push(trashResult.error.message);
		}
		const stderr = trashResult.stderr?.trim();
		if (stderr) {
			parts.push(stderr.split("\n")[0] ?? stderr);
		}
		if (parts.length === 0) return null;
		return `trash: ${parts.join(" · ").slice(0, 200)}`;
	};

	// If trash reports success, or the file is gone afterwards, treat it as successful
	if (trashResult.status === 0 || !existsSync(sessionPath)) {
		return { ok: true, method: "trash" };
	}

	// Fallback to permanent deletion
	try {
		await unlink(sessionPath);
		return { ok: true, method: "unlink" };
	} catch (err) {
		const unlinkError = err instanceof Error ? err.message : String(err);
		const trashErrorHint = getTrashErrorHint();
		const error = trashErrorHint ? `${unlinkError} (${trashErrorHint})` : unlinkError;
		return { ok: false, method: "unlink", error };
	}
}

/**
 * Component that renders a session selector
 */
export class SessionSelectorComponent extends Container implements Focusable {
	handleInput(data: string): void {
		if (this.mode === "rename") {
			const kb = getEditorKeybindings();
			if (kb.matches(data, "selectCancel") || matchesKey(data, "ctrl+c")) {
				this.exitRenameMode();
				return;
			}
			this.renameInput.handleInput(data);
			return;
		}

		this.sessionList.handleInput(data);
	}

	private canRename = true;
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
	private renameSession?: (sessionPath: string, currentName: string | undefined) => Promise<void>;
	private currentLoading = false;
	private allLoading = false;
	private allLoadSeq = 0;

	private mode: "list" | "rename" = "list";
	private renameInput = new Input();
	private renameTargetPath: string | null = null;

	// Focusable implementation - propagate to sessionList for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.sessionList.focused = value;
		this.renameInput.focused = value;
		if (value && this.mode === "rename") {
			this.renameInput.focused = true;
		}
	}

	private buildBaseLayout(content: Component, options?: { showHeader?: boolean }): void {
		this.clear();
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
		this.addChild(new Spacer(1));
		if (options?.showHeader ?? true) {
			this.addChild(this.header);
			this.addChild(new Spacer(1));
		}
		this.addChild(content);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
	}

	constructor(
		currentSessionsLoader: SessionsLoader,
		allSessionsLoader: SessionsLoader,
		onSelect: (sessionPath: string) => void,
		onCancel: () => void,
		onExit: () => void,
		requestRender: () => void,
		options?: {
			renameSession?: (sessionPath: string, currentName: string | undefined) => Promise<void>;
			showRenameHint?: boolean;
		},
		currentSessionFilePath?: string,
	) {
		super();
		this.currentSessionsLoader = currentSessionsLoader;
		this.allSessionsLoader = allSessionsLoader;
		this.onCancel = onCancel;
		this.requestRender = requestRender;
		this.header = new SessionSelectorHeader(this.scope, this.sortMode, this.requestRender);
		const renameSession = options?.renameSession;
		this.renameSession = renameSession;
		this.canRename = !!renameSession;
		this.header.setShowRenameHint(options?.showRenameHint ?? this.canRename);

		// Create session list (starts empty, will be populated after load)
		this.sessionList = new SessionList([], false, this.sortMode, currentSessionFilePath);

		this.buildBaseLayout(this.sessionList);

		this.renameInput.onSubmit = (value) => {
			void this.confirmRename(value);
		};

		// Ensure header status timeouts are cleared when leaving the selector
		const clearStatusMessage = () => this.header.setStatusMessage(null);
		this.sessionList.onSelect = (sessionPath) => {
			clearStatusMessage();
			onSelect(sessionPath);
		};
		this.sessionList.onCancel = () => {
			clearStatusMessage();
			onCancel();
		};
		this.sessionList.onExit = () => {
			clearStatusMessage();
			onExit();
		};
		this.sessionList.onToggleScope = () => this.toggleScope();
		this.sessionList.onToggleSort = () => this.toggleSortMode();
		this.sessionList.onRenameSession = (sessionPath) => {
			if (!renameSession) return;
			if (this.scope === "current" && this.currentLoading) return;
			if (this.scope === "all" && this.allLoading) return;

			const sessions = this.scope === "all" ? (this.allSessions ?? []) : (this.currentSessions ?? []);
			const session = sessions.find((s) => s.path === sessionPath);
			this.enterRenameMode(sessionPath, session?.name);
		};

		// Sync list events to header
		this.sessionList.onTogglePath = (showPath) => {
			this.header.setShowPath(showPath);
			this.requestRender();
		};
		this.sessionList.onDeleteConfirmationChange = (path) => {
			this.header.setConfirmingDeletePath(path);
			this.requestRender();
		};
		this.sessionList.onError = (msg) => {
			this.header.setStatusMessage({ type: "error", message: msg }, 3000);
			this.requestRender();
		};

		// Handle session deletion
		this.sessionList.onDeleteSession = async (sessionPath: string) => {
			const result = await deleteSessionFile(sessionPath);

			if (result.ok) {
				if (this.currentSessions) {
					this.currentSessions = this.currentSessions.filter((s) => s.path !== sessionPath);
				}
				if (this.allSessions) {
					this.allSessions = this.allSessions.filter((s) => s.path !== sessionPath);
				}

				const sessions = this.scope === "all" ? (this.allSessions ?? []) : (this.currentSessions ?? []);
				const showCwd = this.scope === "all";
				this.sessionList.setSessions(sessions, showCwd);

				const msg = result.method === "trash" ? "Session moved to trash" : "Session deleted";
				this.header.setStatusMessage({ type: "info", message: msg }, 2000);
				await this.refreshSessionsAfterMutation();
			} else {
				const errorMessage = result.error ?? "Unknown error";
				this.header.setStatusMessage({ type: "error", message: `Failed to delete: ${errorMessage}` }, 3000);
			}

			this.requestRender();
		};

		// Start loading current sessions immediately
		this.loadCurrentSessions();
	}

	private loadCurrentSessions(): void {
		void this.loadScope("current", "initial");
	}

	private enterRenameMode(sessionPath: string, currentName: string | undefined): void {
		this.mode = "rename";
		this.renameTargetPath = sessionPath;
		this.renameInput.setValue(currentName ?? "");
		this.renameInput.focused = true;

		const panel = new Container();
		panel.addChild(new Text(theme.bold("Rename Session"), 1, 0));
		panel.addChild(new Spacer(1));
		panel.addChild(this.renameInput);
		panel.addChild(new Spacer(1));
		panel.addChild(new Text(theme.fg("muted", "Enter to save · Esc/Ctrl+C to cancel"), 1, 0));

		this.buildBaseLayout(panel, { showHeader: false });
		this.requestRender();
	}

	private exitRenameMode(): void {
		this.mode = "list";
		this.renameTargetPath = null;

		this.buildBaseLayout(this.sessionList);

		this.requestRender();
	}

	private async confirmRename(value: string): Promise<void> {
		const next = value.trim();
		if (!next) return;
		const target = this.renameTargetPath;
		if (!target) {
			this.exitRenameMode();
			return;
		}

		// Find current name for callback
		const renameSession = this.renameSession;
		if (!renameSession) {
			this.exitRenameMode();
			return;
		}

		try {
			await renameSession(target, next);
			await this.refreshSessionsAfterMutation();
		} finally {
			this.exitRenameMode();
		}
	}

	private async loadScope(scope: SessionScope, reason: "initial" | "refresh" | "toggle"): Promise<void> {
		const showCwd = scope === "all";

		// Mark loading
		if (scope === "current") {
			this.currentLoading = true;
		} else {
			this.allLoading = true;
		}

		const seq = scope === "all" ? ++this.allLoadSeq : undefined;
		this.header.setScope(scope);
		this.header.setLoading(true);
		this.requestRender();

		const onProgress = (loaded: number, total: number) => {
			if (scope !== this.scope) return;
			if (seq !== undefined && seq !== this.allLoadSeq) return;
			this.header.setProgress(loaded, total);
			this.requestRender();
		};

		try {
			const sessions = await (scope === "current"
				? this.currentSessionsLoader(onProgress)
				: this.allSessionsLoader(onProgress));

			if (scope === "current") {
				this.currentSessions = sessions;
				this.currentLoading = false;
			} else {
				this.allSessions = sessions;
				this.allLoading = false;
			}

			if (scope !== this.scope) return;
			if (seq !== undefined && seq !== this.allLoadSeq) return;

			this.header.setLoading(false);
			this.sessionList.setSessions(sessions, showCwd);
			this.requestRender();

			if (scope === "all" && sessions.length === 0 && (this.currentSessions?.length ?? 0) === 0) {
				this.onCancel();
			}
		} catch (err) {
			if (scope === "current") {
				this.currentLoading = false;
			} else {
				this.allLoading = false;
			}

			if (scope !== this.scope) return;
			if (seq !== undefined && seq !== this.allLoadSeq) return;

			const message = err instanceof Error ? err.message : String(err);
			this.header.setLoading(false);
			this.header.setStatusMessage({ type: "error", message: `Failed to load sessions: ${message}` }, 4000);

			if (reason === "initial") {
				this.sessionList.setSessions([], showCwd);
			}
			this.requestRender();
		}
	}

	private toggleSortMode(): void {
		this.sortMode = this.sortMode === "recent" ? "relevance" : "recent";
		this.header.setSortMode(this.sortMode);
		this.sessionList.setSortMode(this.sortMode);
		this.requestRender();
	}

	private async refreshSessionsAfterMutation(): Promise<void> {
		await this.loadScope(this.scope, "refresh");
	}

	private toggleScope(): void {
		if (this.scope === "current") {
			this.scope = "all";
			this.header.setScope(this.scope);

			if (this.allSessions !== null) {
				this.header.setLoading(false);
				this.sessionList.setSessions(this.allSessions, true);
				this.requestRender();
				return;
			}

			if (!this.allLoading) {
				void this.loadScope("all", "toggle");
			}
			return;
		}

		this.scope = "current";
		this.header.setScope(this.scope);
		this.header.setLoading(this.currentLoading);
		this.sessionList.setSessions(this.currentSessions ?? [], false);
		this.requestRender();
	}

	getSessionList(): SessionList {
		return this.sessionList;
	}
}
