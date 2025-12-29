import {
	type Component,
	Container,
	isArrowDown,
	isArrowUp,
	isBackspace,
	isCtrlC,
	isCtrlO,
	isCtrlU,
	isEnter,
	isEscape,
	Spacer,
	Text,
	truncateToWidth,
} from "@mariozechner/pi-tui";
import type { SessionTreeNode } from "../../../core/session-manager.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

/** Flattened tree node for navigation */
interface FlatNode {
	node: SessionTreeNode;
	depth: number;
	isLast: boolean;
	/** Prefix chars showing tree structure (│, ├, └, spaces) */
	prefix: string;
}

/** Filter mode for tree display */
type FilterMode = "default" | "user-only" | "all";

/**
 * Tree list component with selection and ASCII art visualization
 */
class TreeList implements Component {
	private flatNodes: FlatNode[] = [];
	private filteredNodes: FlatNode[] = [];
	private selectedIndex = 0;
	private currentLeafId: string | null;
	private maxVisibleLines: number;
	private filterMode: FilterMode = "default";
	private searchQuery = "";

	public onSelect?: (entryId: string) => void;
	public onCancel?: () => void;

	constructor(tree: SessionTreeNode[], currentLeafId: string | null, maxVisibleLines: number) {
		this.currentLeafId = currentLeafId;
		this.maxVisibleLines = maxVisibleLines;
		this.flatNodes = this.flattenTree(tree);
		this.applyFilter();

		// Start with current leaf selected
		const leafIndex = this.filteredNodes.findIndex((n) => n.node.entry.id === currentLeafId);
		if (leafIndex !== -1) {
			this.selectedIndex = leafIndex;
		} else {
			this.selectedIndex = Math.max(0, this.filteredNodes.length - 1);
		}
	}

	private flattenTree(roots: SessionTreeNode[]): FlatNode[] {
		const result: FlatNode[] = [];

		const traverse = (node: SessionTreeNode, depth: number, prefix: string, isLast: boolean) => {
			result.push({ node, depth, isLast, prefix });

			const children = node.children;
			for (let i = 0; i < children.length; i++) {
				const child = children[i];
				const childIsLast = i === children.length - 1;
				const childPrefix = prefix + (isLast ? "   " : "│  ");
				traverse(child, depth + 1, childPrefix, childIsLast);
			}
		};

		for (let i = 0; i < roots.length; i++) {
			traverse(roots[i], 0, "", i === roots.length - 1);
		}

		return result;
	}

	private applyFilter(): void {
		// Parse search tokens (lowercase, split by whitespace)
		const searchTokens = this.searchQuery.toLowerCase().split(/\s+/).filter(Boolean);

		this.filteredNodes = this.flatNodes.filter((flatNode) => {
			const entry = flatNode.node.entry;

			// Apply filter mode first
			let passesFilter = true;
			if (this.filterMode === "user-only") {
				passesFilter =
					(entry.type === "message" && entry.message.role === "user") ||
					(entry.type === "custom_message" && entry.display);
			} else if (this.filterMode !== "all") {
				// Default mode: hide label and custom entries
				passesFilter = entry.type !== "label" && entry.type !== "custom";
			}

			if (!passesFilter) return false;

			// Apply search filter
			if (searchTokens.length > 0) {
				const nodeText = this.getSearchableText(flatNode.node).toLowerCase();
				return searchTokens.every((token) => nodeText.includes(token));
			}

			return true;
		});

		// Adjust selected index if needed
		if (this.selectedIndex >= this.filteredNodes.length) {
			this.selectedIndex = Math.max(0, this.filteredNodes.length - 1);
		}
	}

	/** Get searchable text content from a node */
	private getSearchableText(node: SessionTreeNode): string {
		const entry = node.entry;
		const parts: string[] = [];

		// Add label if present
		if (node.label) {
			parts.push(node.label);
		}

		switch (entry.type) {
			case "message": {
				const msg = entry.message;
				parts.push(msg.role);
				if ("content" in msg && msg.content) {
					parts.push(this.extractContent(msg.content));
				}
				if (msg.role === "bashExecution") {
					const bashMsg = msg as { command?: string };
					if (bashMsg.command) parts.push(bashMsg.command);
				}
				break;
			}
			case "custom_message": {
				parts.push(entry.customType);
				if (typeof entry.content === "string") {
					parts.push(entry.content);
				} else {
					parts.push(this.extractContent(entry.content));
				}
				break;
			}
			case "compaction":
				parts.push("compaction");
				break;
			case "branch_summary":
				parts.push("branch summary", entry.summary);
				break;
			case "model_change":
				parts.push("model", entry.modelId);
				break;
			case "thinking_level_change":
				parts.push("thinking", entry.thinkingLevel);
				break;
			case "custom":
				parts.push("custom", entry.customType);
				break;
			case "label":
				parts.push("label", entry.label ?? "");
				break;
		}

		return parts.join(" ");
	}

	invalidate(): void {
		// No cached state to invalidate
	}

	/** Get current search query for external rendering */
	getSearchQuery(): string {
		return this.searchQuery;
	}

	render(width: number): string[] {
		const lines: string[] = [];

		if (this.filteredNodes.length === 0) {
			lines.push(theme.fg("muted", "  No entries found"));
			// Still show status with filter info
			const filterLabel =
				this.filterMode === "default" ? "" : this.filterMode === "user-only" ? " [user only]" : " [all]";
			lines.push(theme.fg("muted", `  (0/0)${filterLabel}`));
			return lines;
		}

		// Calculate visible range with scrolling
		const startIndex = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(this.maxVisibleLines / 2),
				this.filteredNodes.length - this.maxVisibleLines,
			),
		);
		const endIndex = Math.min(startIndex + this.maxVisibleLines, this.filteredNodes.length);

		for (let i = startIndex; i < endIndex; i++) {
			const flatNode = this.filteredNodes[i];
			const entry = flatNode.node.entry;
			const isSelected = i === this.selectedIndex;
			const isCurrentLeaf = entry.id === this.currentLeafId;

			// Build tree connector
			let connector = "";
			if (flatNode.depth > 0) {
				connector = flatNode.prefix + (flatNode.isLast ? "└─ " : "├─ ");
			}

			// Get entry display text
			const displayText = this.getEntryDisplayText(flatNode.node, width - connector.length - 15);

			// Build suffix
			let suffix = "";
			if (isCurrentLeaf) {
				suffix = theme.fg("accent", " ← active");
			}
			if (flatNode.node.label) {
				suffix += theme.fg("warning", ` [${flatNode.node.label}]`);
			}

			// Combine with selection indicator
			const cursor = isSelected ? theme.fg("accent", "› ") : "  ";
			const text = isSelected ? theme.bold(displayText) : displayText;
			const line = cursor + theme.fg("dim", connector) + text + suffix;

			lines.push(line);
		}

		// Add scroll and filter info (search shown separately above)
		const filterLabel =
			this.filterMode === "default" ? "" : this.filterMode === "user-only" ? " [user only]" : " [all]";
		const scrollInfo = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredNodes.length})${filterLabel}`);
		lines.push(scrollInfo);

		return lines;
	}

	private getEntryDisplayText(node: SessionTreeNode, maxWidth: number): string {
		const entry = node.entry;

		switch (entry.type) {
			case "message": {
				const msg = entry.message;
				const role = msg.role;
				// Handle messages that have content property
				if (role === "user" || role === "assistant" || role === "toolResult") {
					const msgWithContent = msg as { content?: unknown };
					const content = this.extractContent(msgWithContent.content);
					const roleColor = role === "user" ? "accent" : role === "assistant" ? "success" : "muted";
					const roleLabel = theme.fg(roleColor, `${role}: `);
					const truncated = truncateToWidth(content.replace(/\n/g, " ").trim(), maxWidth - role.length - 2);
					return roleLabel + truncated;
				}
				// Handle special message types
				if (role === "bashExecution") {
					const bashMsg = msg as { command?: string };
					return theme.fg("dim", `[bash]: ${bashMsg.command ?? ""}`);
				}
				if (role === "compactionSummary" || role === "branchSummary" || role === "hookMessage") {
					return theme.fg("dim", `[${role}]`);
				}
				return theme.fg("dim", `[${role}]`);
			}
			case "custom_message": {
				const content =
					typeof entry.content === "string"
						? entry.content
						: entry.content
								.filter((c): c is { type: "text"; text: string } => c.type === "text")
								.map((c) => c.text)
								.join("");
				const label = theme.fg("customMessageLabel", `[${entry.customType}]: `);
				const truncated = truncateToWidth(
					content.replace(/\n/g, " ").trim(),
					maxWidth - entry.customType.length - 4,
				);
				return label + truncated;
			}
			case "compaction": {
				const tokens = Math.round(entry.tokensBefore / 1000);
				return theme.fg("borderAccent", `[compaction: ${tokens}k tokens]`);
			}
			case "branch_summary": {
				const truncated = truncateToWidth(entry.summary.replace(/\n/g, " ").trim(), maxWidth - 20);
				return theme.fg("warning", `[branch summary]: `) + truncated;
			}
			case "model_change": {
				return theme.fg("dim", `[model: ${entry.modelId}]`);
			}
			case "thinking_level_change": {
				return theme.fg("dim", `[thinking: ${entry.thinkingLevel}]`);
			}
			case "custom": {
				return theme.fg("dim", `[custom: ${entry.customType}]`);
			}
			case "label": {
				return theme.fg("dim", `[label: ${entry.label ?? "(cleared)"}]`);
			}
		}
	}

	private extractContent(content: unknown): string {
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			return content
				.filter((c) => typeof c === "object" && c !== null && "type" in c && c.type === "text")
				.map((c) => (c as { text: string }).text)
				.join("");
		}
		return "";
	}

	handleInput(keyData: string): void {
		if (isArrowUp(keyData)) {
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredNodes.length - 1 : this.selectedIndex - 1;
		} else if (isArrowDown(keyData)) {
			this.selectedIndex = this.selectedIndex === this.filteredNodes.length - 1 ? 0 : this.selectedIndex + 1;
		} else if (isEnter(keyData)) {
			const selected = this.filteredNodes[this.selectedIndex];
			if (selected && this.onSelect) {
				this.onSelect(selected.node.entry.id);
			}
		} else if (isEscape(keyData)) {
			// Escape: clear search first, then cancel
			if (this.searchQuery) {
				this.searchQuery = "";
				this.applyFilter();
			} else {
				this.onCancel?.();
			}
		} else if (isCtrlC(keyData)) {
			this.onCancel?.();
		} else if (isCtrlU(keyData)) {
			// Toggle user-only filter
			this.filterMode = this.filterMode === "user-only" ? "default" : "user-only";
			this.applyFilter();
		} else if (isCtrlO(keyData)) {
			// Toggle show-all filter
			this.filterMode = this.filterMode === "all" ? "default" : "all";
			this.applyFilter();
		} else if (isBackspace(keyData)) {
			// Remove last character from search
			if (this.searchQuery.length > 0) {
				this.searchQuery = this.searchQuery.slice(0, -1);
				this.applyFilter();
			}
		} else {
			// Check for printable characters (reject control chars)
			const hasControlChars = [...keyData].some((ch) => {
				const code = ch.charCodeAt(0);
				return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
			});
			if (!hasControlChars && keyData.length > 0) {
				this.searchQuery += keyData;
				this.applyFilter();
			}
		}
	}
}

/** Component that displays the current search query */
class SearchLine implements Component {
	constructor(private treeList: TreeList) {}

	invalidate(): void {}

	render(_width: number): string[] {
		const query = this.treeList.getSearchQuery();
		if (query) {
			return [`  ${theme.fg("muted", "Search:")} ${theme.fg("accent", query)}`];
		}
		return [`  ${theme.fg("muted", "Search:")}`];
	}

	handleInput(_keyData: string): void {}
}

/**
 * Component that renders a session tree selector for navigation
 */
export class TreeSelectorComponent extends Container {
	private treeList: TreeList;

	constructor(
		tree: SessionTreeNode[],
		currentLeafId: string | null,
		terminalHeight: number,
		onSelect: (entryId: string) => void,
		onCancel: () => void,
	) {
		super();

		// Cap at half terminal height
		const maxVisibleLines = Math.max(5, Math.floor(terminalHeight / 2));

		// Create tree list first (needed by SearchLine)
		this.treeList = new TreeList(tree, currentLeafId, maxVisibleLines);
		this.treeList.onSelect = onSelect;
		this.treeList.onCancel = onCancel;

		// Layout:
		// Title
		// Border
		// Help text
		// Search field
		// Border
		// Tree entries
		// Border

		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold("Session Tree"), 1, 0));
		this.addChild(new DynamicBorder());
		this.addChild(new Text(theme.fg("muted", "  Type to search. Ctrl+U: user only, Ctrl+O: all"), 0, 0));
		this.addChild(new SearchLine(this.treeList));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(this.treeList);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		// Auto-cancel if empty tree
		if (tree.length === 0) {
			setTimeout(() => onCancel(), 100);
		}
	}

	getTreeList(): TreeList {
		return this.treeList;
	}
}
