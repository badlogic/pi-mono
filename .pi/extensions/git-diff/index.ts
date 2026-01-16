/**
 * Git Diff Extension
 *
 * Shows modified/added/removed files in the git worktree and displays their diffs.
 *
 * Usage:
 * - Press Ctrl+F or type /diff to open the file picker
 * - Select a file to view its diff
 * - Use Up/Down or Left/Right to scroll the diff
 * - Press Escape to close
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
	Container,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";

interface GitFile {
	status: "M" | "A" | "D" | "R" | "C" | "U" | "?";
	path: string;
	staged: boolean;
}

type FileStatus = GitFile["status"];

const STATUS_LABELS: Record<FileStatus, string> = {
	M: "modified",
	A: "added",
	D: "deleted",
	R: "renamed",
	C: "copied",
	U: "unmerged",
	"?": "untracked",
};

const STATUS_COLORS: Record<FileStatus, "warning" | "success" | "error" | "muted"> = {
	M: "warning",
	A: "success",
	D: "error",
	R: "warning",
	C: "warning",
	U: "error",
	"?": "muted",
};

/**
 * Parse git status --porcelain output into file list
 */
function parseGitStatus(output: string): GitFile[] {
	const files: GitFile[] = [];
	const lines = output.trim().split("\n").filter(Boolean);

	for (const line of lines) {
		if (line.length < 3) continue;

		const indexStatus = line[0];
		const workTreeStatus = line[1];
		const path = line.slice(3);

		// Staged changes (index has status, worktree is space or has same status)
		if (indexStatus !== " " && indexStatus !== "?") {
			files.push({
				status: indexStatus as FileStatus,
				path,
				staged: true,
			});
		}

		// Unstaged changes (worktree has status different from index)
		if (workTreeStatus !== " " && workTreeStatus !== "?") {
			// Don't duplicate if same status in both
			if (indexStatus === " " || indexStatus !== workTreeStatus) {
				files.push({
					status: workTreeStatus as FileStatus,
					path,
					staged: false,
				});
			}
		}

		// Untracked files
		if (indexStatus === "?" && workTreeStatus === "?") {
			files.push({
				status: "?",
				path,
				staged: false,
			});
		}
	}

	return files;
}

/**
 * Render a unified diff with colors
 */
function renderUnifiedDiff(diffText: string, theme: Theme): string[] {
	const lines = diffText.split("\n");
	const result: string[] = [];

	for (const line of lines) {
		if (line.startsWith("+++") || line.startsWith("---")) {
			// File headers
			result.push(theme.fg("muted", line));
		} else if (line.startsWith("@@")) {
			// Hunk headers
			result.push(theme.fg("accent", line));
		} else if (line.startsWith("+")) {
			result.push(theme.fg("toolDiffAdded", line));
		} else if (line.startsWith("-")) {
			result.push(theme.fg("toolDiffRemoved", line));
		} else if (line.startsWith("diff --git")) {
			result.push(theme.fg("dim", line));
		} else if (line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file")) {
			result.push(theme.fg("dim", line));
		} else {
			result.push(theme.fg("toolDiffContext", line));
		}
	}

	return result;
}

/**
 * Scrollable diff viewer component
 */
class DiffViewer {
	private lines: string[] = [];
	private scrollOffset = 0;
	private viewportHeight = 20;
	private filePath: string;

	onClose?: () => void;

	constructor(
		private theme: Theme,
		filePath: string,
		diffText: string,
	) {
		this.filePath = filePath;
		this.lines = renderUnifiedDiff(diffText, theme);
	}

	handleInput(data: string): void {
		const maxScroll = Math.max(0, this.lines.length - this.viewportHeight + 4);

		if (matchesKey(data, Key.escape)) {
			this.onClose?.();
		} else if (matchesKey(data, Key.up) || matchesKey(data, Key.left)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
		} else if (matchesKey(data, Key.down) || matchesKey(data, Key.right)) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
		} else if (matchesKey(data, Key.pageUp) || matchesKey(data, "shift+up")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - this.viewportHeight);
		} else if (matchesKey(data, Key.pageDown) || matchesKey(data, "shift+down")) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + this.viewportHeight);
		} else if (matchesKey(data, Key.home) || matchesKey(data, "g")) {
			this.scrollOffset = 0;
		} else if (matchesKey(data, Key.end) || matchesKey(data, "shift+g")) {
			this.scrollOffset = maxScroll;
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const result: string[] = [];
		const innerWidth = width - 2;

		// Calculate viewport (leave room for header, footer, borders)
		this.viewportHeight = Math.max(5, 20);

		const maxScroll = Math.max(0, this.lines.length - this.viewportHeight + 4);
		const visibleLines = this.lines.slice(this.scrollOffset, this.scrollOffset + this.viewportHeight);

		// Helper to create bordered line
		const row = (content: string) => {
			const vis = visibleWidth(content);
			const padding = Math.max(0, innerWidth - vis);
			return th.fg("border", "│") + content + " ".repeat(padding) + th.fg("border", "│");
		};

		// Top border
		result.push(th.fg("border", "╭" + "─".repeat(innerWidth) + "╮"));

		// Header with file path
		const header = ` ${th.fg("accent", th.bold(truncateToWidth(this.filePath, innerWidth - 2)))}`;
		result.push(row(header));
		result.push(row(""));

		// Diff content
		for (const line of visibleLines) {
			result.push(row(" " + truncateToWidth(line, innerWidth - 2)));
		}

		// Pad if fewer lines than viewport
		const paddingNeeded = this.viewportHeight - visibleLines.length;
		for (let i = 0; i < paddingNeeded; i++) {
			result.push(row(""));
		}

		// Scroll indicator
		const scrollInfo =
			this.lines.length > this.viewportHeight
				? `${this.scrollOffset + 1}-${Math.min(this.scrollOffset + this.viewportHeight, this.lines.length)} of ${this.lines.length}`
				: `${this.lines.length} lines`;
		result.push(row(""));
		result.push(row(` ${th.fg("dim", scrollInfo)}`));

		// Footer with help
		result.push(row(` ${th.fg("dim", "↑↓/←→ scroll • PgUp/PgDn page • g/G start/end • Esc close")}`));

		// Bottom border
		result.push(th.fg("border", "╰" + "─".repeat(innerWidth) + "╯"));

		return result;
	}

	invalidate(): void {}
}

/**
 * Show the diff for a file
 */
async function showFileDiff(file: GitFile, ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	// Get the diff
	let diffArgs: string[];
	if (file.status === "?") {
		// Untracked file: show full content as "added"
		const result = await pi.exec("cat", [file.path], { cwd: ctx.cwd });
		if (result.code !== 0) {
			ctx.ui.notify(`Failed to read ${file.path}`, "error");
			return;
		}
		// Create a fake diff showing all lines as added
		const lines = result.stdout.split("\n");
		const diffText = [
			`diff --git a/${file.path} b/${file.path}`,
			"new file",
			`--- /dev/null`,
			`+++ b/${file.path}`,
			`@@ -0,0 +1,${lines.length} @@`,
			...lines.map((l) => "+" + l),
		].join("\n");

		await showDiffViewer(file.path, diffText, ctx);
		return;
	}

	if (file.staged) {
		diffArgs = ["diff", "--cached", "--", file.path];
	} else {
		diffArgs = ["diff", "--", file.path];
	}

	const result = await pi.exec("git", diffArgs, { cwd: ctx.cwd });
	if (result.code !== 0) {
		ctx.ui.notify(`Failed to get diff for ${file.path}: ${result.stderr}`, "error");
		return;
	}

	if (!result.stdout.trim()) {
		ctx.ui.notify(`No diff available for ${file.path}`, "info");
		return;
	}

	await showDiffViewer(file.path, result.stdout, ctx);
}

async function showDiffViewer(filePath: string, diffText: string, ctx: ExtensionContext): Promise<void> {
	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const viewer = new DiffViewer(theme, filePath, diffText);
		viewer.onClose = () => done();

		return {
			render: (w) => viewer.render(w),
			invalidate: () => viewer.invalidate(),
			handleInput: (data) => {
				viewer.handleInput(data);
				tui.requestRender();
			},
		};
	}, { overlay: true });
}

/**
 * Show the file picker overlay
 */
async function showFilePicker(files: GitFile[], ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	// Group files by status
	const items: SelectItem[] = files.map((file) => {
		const statusLabel = STATUS_LABELS[file.status];
		const stagedLabel = file.staged ? " (staged)" : "";
		return {
			value: file,
			label: file.path,
			description: `${statusLabel}${stagedLabel}`,
		};
	});

	const result = await ctx.ui.custom<GitFile | null>((tui, theme, _kb, done) => {
		const container = new Container();

		// Top border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		// Title
		const title = new Text(theme.fg("accent", theme.bold("Git Changes")) + theme.fg("dim", ` (${files.length} files)`), 1, 0);
		container.addChild(title);

		// File list
		const selectList = new SelectList(items, Math.min(items.length, 15), {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => {
				// Color description based on status keyword
				if (t.startsWith("modified")) return theme.fg("warning", t);
				if (t.startsWith("added")) return theme.fg("success", t);
				if (t.startsWith("deleted")) return theme.fg("error", t);
				if (t.startsWith("untracked")) return theme.fg("muted", t);
				if (t.startsWith("renamed") || t.startsWith("copied")) return theme.fg("warning", t);
				if (t.startsWith("unmerged")) return theme.fg("error", t);
				return theme.fg("muted", t);
			},
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		});

		selectList.onSelect = (item) => done(item.value as GitFile);
		selectList.onCancel = () => done(null);
		container.addChild(selectList);

		// Help text
		container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • type to filter • esc close"), 1, 0));

		// Bottom border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (w) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	}, { overlay: true });

	if (result) {
		await showFileDiff(result, ctx, pi);
		// After viewing diff, show file picker again
		await showFilePicker(files, ctx, pi);
	}
}

/**
 * Main handler for showing the diff overlay
 */
async function showDiffOverlay(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	// Check if we're in a git repo
	const gitCheck = await pi.exec("git", ["rev-parse", "--git-dir"], { cwd: ctx.cwd });
	if (gitCheck.code !== 0) {
		ctx.ui.notify("Not in a git repository", "error");
		return;
	}

	// Get changed files
	const statusResult = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd });
	if (statusResult.code !== 0) {
		ctx.ui.notify(`Git status failed: ${statusResult.stderr}`, "error");
		return;
	}

	if (!statusResult.stdout.trim()) {
		ctx.ui.notify("No changes in working tree", "info");
		return;
	}

	const files = parseGitStatus(statusResult.stdout);
	if (files.length === 0) {
		ctx.ui.notify("No changes in working tree", "info");
		return;
	}

	await showFilePicker(files, ctx, pi);
}

export default function gitDiffExtension(pi: ExtensionAPI) {
	// Register Ctrl+F shortcut
	pi.registerShortcut(Key.ctrl("f"), {
		description: "Show git diff overlay",
		handler: async (ctx) => {
			await showDiffOverlay(ctx, pi);
		},
	});

	// Register /diff command
	pi.registerCommand("diff", {
		description: "Show modified files and their diffs",
		handler: async (_args, ctx) => {
			await showDiffOverlay(ctx, pi);
		},
	});
}
