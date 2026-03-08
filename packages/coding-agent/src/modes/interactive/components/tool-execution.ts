import * as os from "node:os";
import {
	Box,
	type Component,
	Container,
	getCapabilities,
	getImageDimensions,
	Image,
	imageFallback,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
} from "@mariozechner/pi-tui";
import stripAnsi from "strip-ansi";
import type { ToolDefinition } from "../../../core/extensions/types.js";
import { computeEditDiff, type EditDiffError, type EditDiffResult } from "../../../core/tools/edit-diff.js";
import { allTools } from "../../../core/tools/index.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "../../../core/tools/truncate.js";
import { convertToPng } from "../../../utils/image-convert.js";
import { sanitizeBinaryOutput } from "../../../utils/shell.js";
import { getLanguageFromPath, highlightCode, theme } from "../theme/theme.js";
import { renderDiff } from "./diff.js";
import { keyHint } from "./keybinding-hints.js";
import {
	CachedOutputBlock,
	clampDisplayLine,
	formatExecutionDuration,
	humanizeToolName,
	type OutputBlockSection,
	renderToolStatusLine,
	type ToolBlockState,
} from "./tool-ui.js";

// Preview line limit for bash when not expanded
const BASH_PREVIEW_LINES = 5;
// During partial write tool-call streaming, re-highlight the first N lines fully
// to keep multiline tokenization mostly correct without re-highlighting the full file.
const WRITE_PARTIAL_FULL_HIGHLIGHT_LINES = 50;

/**
 * Convert absolute path to tilde notation if it's in home directory
 */
function shortenPath(path: unknown): string {
	if (typeof path !== "string") return "";
	const home = os.homedir();
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

/**
 * Replace tabs with spaces for consistent rendering
 */
function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

/** Safely coerce value to string for display. Returns null if invalid type. */
function str(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (value == null) return "";
	return null; // Invalid type
}

export interface ToolExecutionOptions {
	showImages?: boolean; // default: true (only used if terminal supports images)
	trackDuration?: boolean;
	startedAt?: number;
	durationMs?: number;
}

type WriteHighlightCache = {
	rawPath: string | null;
	lang: string;
	rawContent: string;
	normalizedLines: string[];
	highlightedLines: string[];
};

/**
 * Component that renders a tool call with its result (updateable)
 */
export class ToolExecutionComponent extends Container {
	private contentHost: Container;
	private contentBox: Box; // Used for custom tool renderers
	private contentText: Text; // Used for unknown tool fallbacks
	private builtInBox: Box; // Used for built-in tools with rich block rendering
	private activeContentChild?: Component;
	private builtInRenderer: Component;
	private builtInBlockCache = new CachedOutputBlock();
	private imageComponents: Image[] = [];
	private imageSpacers: Spacer[] = [];
	private toolName: string;
	private toolLabel: string;
	private args: any;
	private expanded = false;
	private showImages: boolean;
	private isPartial = true;
	private toolDefinition?: ToolDefinition;
	private ui: TUI;
	private cwd: string;
	private startedAt: number | undefined;
	private durationMs: number | undefined;
	private trackDuration: boolean;
	private result?: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		isError: boolean;
		details?: any;
	};
	// Cached edit diff preview (computed when args arrive, before tool executes)
	private editDiffPreview?: EditDiffResult | EditDiffError;
	private editDiffArgsKey?: string; // Track which args the preview is for
	// Cached converted images for Kitty protocol (which requires PNG), keyed by index
	private convertedImages: Map<number, { data: string; mimeType: string }> = new Map();
	// Incremental syntax highlighting cache for write tool call args
	private writeHighlightCache?: WriteHighlightCache;
	// When true, this component intentionally renders no lines
	private hideComponent = false;

	constructor(
		toolName: string,
		args: any,
		options: ToolExecutionOptions = {},
		toolDefinition: ToolDefinition | undefined,
		ui: TUI,
		cwd: string = process.cwd(),
	) {
		super();
		this.toolName = toolName;
		this.toolLabel = toolDefinition?.label ?? humanizeToolName(toolName);
		this.args = args;
		this.showImages = options.showImages ?? true;
		this.toolDefinition = toolDefinition;
		this.ui = ui;
		this.cwd = cwd;
		this.trackDuration = options.trackDuration ?? true;
		this.startedAt = options.startedAt ?? (this.trackDuration ? Date.now() : undefined);
		this.durationMs = options.durationMs;

		this.addChild(new Spacer(1));

		this.contentHost = new Container();
		this.addChild(this.contentHost);

		// Always create both - contentBox for custom renderers, contentText for unknown tools
		this.contentBox = new Box(1, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.contentText = new Text("", 1, 1, (text: string) => theme.bg("toolPendingBg", text));
		this.builtInBox = new Box(0, 0);
		this.builtInRenderer = {
			render: (width: number) => this.renderBuiltInBlock(width),
			invalidate: () => {
				this.builtInBlockCache.invalidate();
			},
		};

		this.updateDisplay();
	}

	/**
	 * Check if we should use built-in rendering for this tool.
	 * Returns true if the tool name is a built-in AND either there's no toolDefinition
	 * or the toolDefinition doesn't provide custom renderers.
	 */
	private shouldUseBuiltInRenderer(): boolean {
		const isBuiltInName = this.toolName in allTools;
		const hasCustomRenderers = this.toolDefinition?.renderCall || this.toolDefinition?.renderResult;
		return isBuiltInName && !hasCustomRenderers;
	}

	private setActiveContentChild(component: Component): void {
		if (this.activeContentChild === component) {
			return;
		}
		this.contentHost.clear();
		this.contentHost.addChild(component);
		this.activeContentChild = component;
	}

	updateArgs(args: any): void {
		this.args = args;
		if (this.toolName === "write" && this.isPartial) {
			this.updateWriteHighlightCacheIncremental();
		}
		this.updateDisplay();
	}

	private highlightSingleLine(line: string, lang: string): string {
		const highlighted = highlightCode(line, lang);
		return highlighted[0] ?? "";
	}

	private refreshWriteHighlightPrefix(cache: WriteHighlightCache): void {
		const prefixCount = Math.min(WRITE_PARTIAL_FULL_HIGHLIGHT_LINES, cache.normalizedLines.length);
		if (prefixCount === 0) return;

		const prefixSource = cache.normalizedLines.slice(0, prefixCount).join("\n");
		const prefixHighlighted = highlightCode(prefixSource, cache.lang);
		for (let i = 0; i < prefixCount; i++) {
			cache.highlightedLines[i] =
				prefixHighlighted[i] ?? this.highlightSingleLine(cache.normalizedLines[i] ?? "", cache.lang);
		}
	}

	private rebuildWriteHighlightCacheFull(rawPath: string | null, fileContent: string): void {
		const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
		if (!lang) {
			this.writeHighlightCache = undefined;
			return;
		}

		const normalized = replaceTabs(fileContent);
		this.writeHighlightCache = {
			rawPath,
			lang,
			rawContent: fileContent,
			normalizedLines: normalized.split("\n"),
			highlightedLines: highlightCode(normalized, lang),
		};
	}

	private updateWriteHighlightCacheIncremental(): void {
		const rawPath = str(this.args?.file_path ?? this.args?.path);
		const fileContent = str(this.args?.content);
		if (rawPath === null || fileContent === null) {
			this.writeHighlightCache = undefined;
			return;
		}

		const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
		if (!lang) {
			this.writeHighlightCache = undefined;
			return;
		}

		if (!this.writeHighlightCache) {
			this.rebuildWriteHighlightCacheFull(rawPath, fileContent);
			return;
		}

		const cache = this.writeHighlightCache;
		if (cache.lang !== lang || cache.rawPath !== rawPath) {
			this.rebuildWriteHighlightCacheFull(rawPath, fileContent);
			return;
		}

		if (!fileContent.startsWith(cache.rawContent)) {
			this.rebuildWriteHighlightCacheFull(rawPath, fileContent);
			return;
		}

		if (fileContent.length === cache.rawContent.length) {
			return;
		}

		const deltaRaw = fileContent.slice(cache.rawContent.length);
		const deltaNormalized = replaceTabs(deltaRaw);
		cache.rawContent = fileContent;

		if (cache.normalizedLines.length === 0) {
			cache.normalizedLines.push("");
			cache.highlightedLines.push("");
		}

		const segments = deltaNormalized.split("\n");
		const lastIndex = cache.normalizedLines.length - 1;
		cache.normalizedLines[lastIndex] += segments[0];
		cache.highlightedLines[lastIndex] = this.highlightSingleLine(cache.normalizedLines[lastIndex], cache.lang);

		for (let i = 1; i < segments.length; i++) {
			cache.normalizedLines.push(segments[i]);
			cache.highlightedLines.push(this.highlightSingleLine(segments[i], cache.lang));
		}

		this.refreshWriteHighlightPrefix(cache);
	}

	/**
	 * Signal that args are complete (tool is about to execute).
	 * This triggers diff computation for edit tool.
	 */
	setArgsComplete(): void {
		if (this.toolName === "write") {
			const rawPath = str(this.args?.file_path ?? this.args?.path);
			const fileContent = str(this.args?.content);
			if (rawPath !== null && fileContent !== null) {
				this.rebuildWriteHighlightCacheFull(rawPath, fileContent);
			}
		}
		this.maybeComputeEditDiff();
	}

	/**
	 * Compute edit diff preview when we have complete args.
	 * This runs async and updates display when done.
	 */
	private maybeComputeEditDiff(): void {
		if (this.toolName !== "edit") return;

		const path = this.args?.path;
		const oldText = this.args?.oldText;
		const newText = this.args?.newText;

		// Need all three params to compute diff
		if (!path || oldText === undefined || newText === undefined) return;

		// Create a key to track which args this computation is for
		const argsKey = JSON.stringify({ path, oldText, newText });

		// Skip if we already computed for these exact args
		if (this.editDiffArgsKey === argsKey) return;

		this.editDiffArgsKey = argsKey;

		// Compute diff async
		computeEditDiff(path, oldText, newText, this.cwd).then((result) => {
			// Only update if args haven't changed since we started
			if (this.editDiffArgsKey === argsKey) {
				this.editDiffPreview = result;
				this.updateDisplay();
				this.ui.requestRender();
			}
		});
	}

	updateResult(
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: any;
			isError: boolean;
		},
		isPartial = false,
	): void {
		this.result = result;
		this.isPartial = isPartial;
		if (!isPartial) {
			this.durationMs =
				typeof result.details?.durationMs === "number"
					? Math.max(0, result.details.durationMs)
					: this.trackDuration && this.startedAt !== undefined
						? Math.max(0, Date.now() - this.startedAt)
						: undefined;
		}
		if (this.toolName === "write" && !isPartial) {
			const rawPath = str(this.args?.file_path ?? this.args?.path);
			const fileContent = str(this.args?.content);
			if (rawPath !== null && fileContent !== null) {
				this.rebuildWriteHighlightCacheFull(rawPath, fileContent);
			}
		}
		this.updateDisplay();
		// Convert non-PNG images to PNG for Kitty protocol (async)
		this.maybeConvertImagesForKitty();
	}

	/**
	 * Convert non-PNG images to PNG for Kitty graphics protocol.
	 * Kitty requires PNG format (f=100), so JPEG/GIF/WebP won't display.
	 */
	private maybeConvertImagesForKitty(): void {
		const caps = getCapabilities();
		// Only needed for Kitty protocol
		if (caps.images !== "kitty") return;
		if (!this.result) return;

		const imageBlocks = this.result.content?.filter((c: any) => c.type === "image") || [];

		for (let i = 0; i < imageBlocks.length; i++) {
			const img = imageBlocks[i];
			if (!img.data || !img.mimeType) continue;
			// Skip if already PNG or already converted
			if (img.mimeType === "image/png") continue;
			if (this.convertedImages.has(i)) continue;

			// Convert async
			const index = i;
			convertToPng(img.data, img.mimeType).then((converted) => {
				if (converted) {
					this.convertedImages.set(index, converted);
					this.updateDisplay();
					this.ui.requestRender();
				}
			});
		}
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setShowImages(show: boolean): void {
		this.showImages = show;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	override render(width: number): string[] {
		if (this.hideComponent) {
			return [];
		}
		return super.render(width);
	}

	private updateDisplay(): void {
		// Set background based on state
		const bgFn = this.isPartial
			? (text: string) => theme.bg("toolPendingBg", text)
			: this.result?.isError
				? (text: string) => theme.bg("toolErrorBg", text)
				: (text: string) => theme.bg("toolSuccessBg", text);

		const useBuiltInRenderer = this.shouldUseBuiltInRenderer();
		let customRendererHasContent = false;
		this.hideComponent = false;
		this.builtInBlockCache.invalidate();

		// Use built-in rendering for built-in tools (or overrides without custom renderers)
		if (useBuiltInRenderer) {
			this.setActiveContentChild(this.builtInBox);
			this.builtInBox.setBgFn(undefined);
			this.builtInBox.clear();
			this.builtInBox.addChild(this.builtInRenderer);
		} else if (this.toolDefinition) {
			this.setActiveContentChild(this.contentBox);
			// Custom tools use Box for flexible component rendering
			this.contentBox.setBgFn(bgFn);
			this.contentBox.clear();

			// Render call component
			if (this.toolDefinition.renderCall) {
				try {
					const callComponent = this.toolDefinition.renderCall(this.args, theme);
					if (callComponent !== undefined) {
						this.contentBox.addChild(callComponent);
						customRendererHasContent = true;
					}
				} catch {
					// Fall back to default on error
					this.contentBox.addChild(new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0));
					customRendererHasContent = true;
				}
			} else {
				// No custom renderCall, show tool name
				this.contentBox.addChild(new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0));
				customRendererHasContent = true;
			}

			// Render result component if we have a result
			if (this.result && this.toolDefinition.renderResult) {
				try {
					const resultComponent = this.toolDefinition.renderResult(
						{ content: this.result.content as any, details: this.result.details },
						{ expanded: this.expanded, isPartial: this.isPartial },
						theme,
					);
					if (resultComponent !== undefined) {
						this.contentBox.addChild(resultComponent);
						customRendererHasContent = true;
					}
				} catch {
					// Fall back to showing raw output on error
					const output = this.getTextOutput();
					if (output) {
						this.contentBox.addChild(new Text(theme.fg("toolOutput", output), 0, 0));
						customRendererHasContent = true;
					}
				}
			} else if (this.result) {
				// Has result but no custom renderResult
				const output = this.getTextOutput();
				if (output) {
					this.contentBox.addChild(new Text(theme.fg("toolOutput", output), 0, 0));
					customRendererHasContent = true;
				}
			}
		} else {
			this.setActiveContentChild(this.contentText);
			// Unknown tool with no registered definition - show generic fallback
			this.contentText.setCustomBgFn(bgFn);
			this.contentText.setText(this.formatToolExecution());
		}

		// Handle images (same for both custom and built-in)
		for (const img of this.imageComponents) {
			this.removeChild(img);
		}
		this.imageComponents = [];
		for (const spacer of this.imageSpacers) {
			this.removeChild(spacer);
		}
		this.imageSpacers = [];

		if (this.result) {
			const imageBlocks = this.result.content?.filter((c: any) => c.type === "image") || [];
			const caps = getCapabilities();

			for (let i = 0; i < imageBlocks.length; i++) {
				const img = imageBlocks[i];
				if (caps.images && this.showImages && img.data && img.mimeType) {
					// Use converted PNG for Kitty protocol if available
					const converted = this.convertedImages.get(i);
					const imageData = converted?.data ?? img.data;
					const imageMimeType = converted?.mimeType ?? img.mimeType;

					// For Kitty, skip non-PNG images that haven't been converted yet
					if (caps.images === "kitty" && imageMimeType !== "image/png") {
						continue;
					}

					const spacer = new Spacer(1);
					this.addChild(spacer);
					this.imageSpacers.push(spacer);
					const imageComponent = new Image(
						imageData,
						imageMimeType,
						{ fallbackColor: (s: string) => theme.fg("toolOutput", s) },
						{ maxWidthCells: 60 },
					);
					this.imageComponents.push(imageComponent);
					this.addChild(imageComponent);
				}
			}
		}

		if (!useBuiltInRenderer && this.toolDefinition) {
			this.hideComponent = !customRendererHasContent && this.imageComponents.length === 0;
		}
	}

	private getToolBlockState(): ToolBlockState {
		if (this.result?.isError) {
			return "error";
		}
		if (this.isPartial) {
			return "pending";
		}
		return "success";
	}

	private renderBuiltInBlock(width: number): string[] {
		return this.builtInBlockCache.render({
			header: this.getToolBlockHeader(),
			state: this.getToolBlockState(),
			sections: this.getToolBlockSections(),
			width,
		});
	}

	private getToolBlockHeader(): string {
		const meta: string[] = [];
		let description = "";

		switch (this.toolName) {
			case "read": {
				const rawPath = str(this.args?.file_path ?? this.args?.path);
				const path = rawPath !== null ? shortenPath(rawPath) : null;
				description = path ?? "[invalid path]";
				const offset = this.args?.offset;
				const limit = this.args?.limit;
				if (offset !== undefined || limit !== undefined) {
					const startLine = offset ?? 1;
					const endLine = limit !== undefined ? startLine + limit - 1 : undefined;
					meta.push(endLine ? `${startLine}-${endLine}` : `${startLine}`);
				}
				break;
			}
			case "write": {
				const rawPath = str(this.args?.file_path ?? this.args?.path);
				const path = rawPath !== null ? shortenPath(rawPath) : null;
				description = path ?? "[invalid path]";
				break;
			}
			case "edit": {
				const rawPath = str(this.args?.file_path ?? this.args?.path);
				const path = rawPath !== null ? shortenPath(rawPath) : null;
				description = path ?? "[invalid path]";
				const firstChangedLine =
					(this.editDiffPreview && "firstChangedLine" in this.editDiffPreview
						? this.editDiffPreview.firstChangedLine
						: undefined) ||
					(this.result && !this.result.isError ? this.result.details?.firstChangedLine : undefined);
				if (typeof firstChangedLine === "number") {
					meta.push(`line ${firstChangedLine}`);
				}
				break;
			}
			case "ls": {
				const rawPath = str(this.args?.path);
				const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
				description = path ?? "[invalid path]";
				if (typeof this.args?.limit === "number") {
					meta.push(`limit ${this.args.limit}`);
				}
				break;
			}
			case "find": {
				const pattern = str(this.args?.pattern);
				const rawPath = str(this.args?.path);
				const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
				description = pattern === null ? "[invalid pattern]" : (pattern ?? "");
				if (path !== null) {
					meta.push(`in ${path}`);
				}
				if (typeof this.args?.limit === "number") {
					meta.push(`limit ${this.args.limit}`);
				}
				break;
			}
			case "grep": {
				const pattern = str(this.args?.pattern);
				const rawPath = str(this.args?.path);
				const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
				description = pattern === null ? "[invalid pattern]" : `/${pattern ?? ""}/`;
				if (path !== null) {
					meta.push(`in ${path}`);
				}
				const glob = str(this.args?.glob);
				if (glob) {
					meta.push(glob);
				}
				if (typeof this.args?.limit === "number") {
					meta.push(`limit ${this.args.limit}`);
				}
				break;
			}
			case "bash": {
				const command = str(this.args?.command);
				description = command === null ? "[invalid command]" : (command ?? "");
				if (typeof this.args?.timeout === "number") {
					meta.push(`timeout ${this.args.timeout}s`);
				}
				break;
			}
			default: {
				description = this.formatInlineArgsPreview();
				break;
			}
		}

		const duration = formatExecutionDuration(this.durationMs);
		if (duration) {
			meta.push(duration);
		}

		return renderToolStatusLine({
			state: this.getToolBlockState(),
			title: this.toolLabel,
			description,
			meta,
		});
	}

	private getToolBlockSections(): OutputBlockSection[] {
		switch (this.toolName) {
			case "read":
				return this.getReadSections();
			case "write":
				return this.getWriteSections();
			case "edit":
				return this.getEditSections();
			case "ls":
			case "find":
			case "grep":
				return this.getListSections();
			case "bash":
				return this.getBashSections();
			default:
				return this.getGenericSections();
		}
	}

	private getReadSections(): OutputBlockSection[] {
		if (!this.result) {
			return [];
		}
		const output = this.getTextOutput();
		const rawPath = str(this.args?.file_path ?? this.args?.path);
		const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
		const lines = lang ? highlightCode(replaceTabs(output), lang) : output.split("\n").map(replaceTabs);
		const preview = this.createPreviewLines(lines, 8, !lang);
		const sections: OutputBlockSection[] = [];
		if (preview.lines.length > 0) {
			sections.push({ lines: preview.lines });
		}
		const notices = [...this.getPreviewNotice(preview.remaining), ...this.getReadTruncationNotices()];
		if (notices.length > 0) {
			sections.push({ lines: notices });
		}
		return sections;
	}

	private getWriteSections(): OutputBlockSection[] {
		const rawPath = str(this.args?.file_path ?? this.args?.path);
		const fileContent = str(this.args?.content);
		const sections: OutputBlockSection[] = [];
		if (fileContent === null) {
			sections.push({ lines: [theme.fg("error", "[invalid content arg - expected string]")] });
		} else if (fileContent) {
			const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
			const lines = this.getWritePreviewLines(lang, rawPath, fileContent);
			const preview = this.createPreviewLines(lines, 8, !lang);
			sections.push({ lines: preview.lines });
			const notices = this.getPreviewNotice(preview.remaining);
			if (notices.length > 0) {
				sections.push({ lines: notices });
			}
		}
		if (this.result?.isError) {
			const errorText = this.getTextOutput();
			if (errorText) {
				sections.push({ label: "Error", lines: [theme.fg("error", errorText)] });
			}
		}
		return sections;
	}

	private getEditSections(): OutputBlockSection[] {
		const sections: OutputBlockSection[] = [];
		if (this.result?.isError) {
			const errorText = this.getTextOutput();
			if (errorText) {
				sections.push({ lines: [theme.fg("error", errorText)] });
			}
			return sections;
		}

		let diffText: string | undefined;
		const rawPath = str(this.args?.file_path ?? this.args?.path);
		if (this.result?.details?.diff) {
			diffText = renderDiff(this.result.details.diff, { filePath: rawPath ?? undefined });
		} else if (this.editDiffPreview) {
			if ("error" in this.editDiffPreview) {
				sections.push({ lines: [theme.fg("error", this.editDiffPreview.error)] });
				return sections;
			}
			if (this.editDiffPreview.diff) {
				diffText = renderDiff(this.editDiffPreview.diff, { filePath: rawPath ?? undefined });
			}
		}
		if (diffText) {
			const diffLines = diffText.split("\n").map((line) => clampDisplayLine(line));
			const preview = this.createPreviewLines(diffLines, 18, false);
			sections.push({ lines: preview.lines });
			const notices = this.getPreviewNotice(preview.remaining);
			if (notices.length > 0) {
				sections.push({ lines: notices });
			}
		}
		return sections;
	}

	private getListSections(): OutputBlockSection[] {
		if (!this.result) {
			return [];
		}
		const output = this.getTextOutput().trim();
		const sections: OutputBlockSection[] = [];
		if (output) {
			const preview = this.createPreviewLines(output.split("\n"), 10, true);
			sections.push({ lines: preview.lines });
			const notices = [...this.getPreviewNotice(preview.remaining), ...this.getListNotices()];
			if (notices.length > 0) {
				sections.push({ lines: notices });
			}
			return sections;
		}
		const notices = this.getListNotices();
		if (notices.length > 0) {
			sections.push({ lines: notices });
		}
		return sections;
	}

	private getBashSections(): OutputBlockSection[] {
		if (!this.result) {
			return [];
		}
		const output = this.getTextOutput().trimEnd();
		const sections: OutputBlockSection[] = [];
		if (output) {
			const preview = this.createPreviewLines(output.split("\n"), BASH_PREVIEW_LINES, true);
			sections.push({ lines: preview.lines });
			const notices = [...this.getPreviewNotice(preview.remaining), ...this.getBashNotices()];
			if (notices.length > 0) {
				sections.push({ lines: notices });
			}
			return sections;
		}
		const notices = this.getBashNotices();
		if (notices.length > 0) {
			sections.push({ lines: notices });
		}
		return sections;
	}

	private getGenericSections(): OutputBlockSection[] {
		const sections: OutputBlockSection[] = [];
		if (this.expanded && this.args !== undefined) {
			const argsText = JSON.stringify(this.args, null, 2) ?? "";
			if (argsText) {
				sections.push({ label: "Args", lines: argsText.split("\n").map((line) => theme.fg("toolOutput", line)) });
			}
		}
		if (!this.result) {
			return sections;
		}
		const output = this.getTextOutput().trimEnd();
		if (!output) {
			sections.push({ lines: [theme.fg("dim", "(no output)")] });
			return sections;
		}
		const preview = this.createPreviewLines(output.split("\n"), 6, true);
		sections.push({ lines: preview.lines });
		const notices = this.getPreviewNotice(preview.remaining);
		if (notices.length > 0) {
			sections.push({ lines: notices });
		}
		return sections;
	}

	private getWritePreviewLines(lang: string | undefined, rawPath: string | null, fileContent: string): string[] {
		if (lang) {
			const cache = this.writeHighlightCache;
			if (cache && cache.lang === lang && cache.rawPath === rawPath && cache.rawContent === fileContent) {
				return cache.highlightedLines;
			}
			const normalized = replaceTabs(fileContent);
			const highlighted = highlightCode(normalized, lang);
			this.writeHighlightCache = {
				rawPath,
				lang,
				rawContent: fileContent,
				normalizedLines: normalized.split("\n"),
				highlightedLines: highlighted,
			};
			return highlighted;
		}
		this.writeHighlightCache = undefined;
		return fileContent.split("\n").map(replaceTabs);
	}

	private createPreviewLines(
		lines: string[],
		collapsedLimit: number,
		applyOutputColor: boolean,
	): {
		lines: string[];
		remaining: number;
	} {
		const totalLines = lines.map((line) => clampDisplayLine(line));
		const maxLines = this.expanded ? totalLines.length : collapsedLimit;
		const displayLines = totalLines
			.slice(0, maxLines)
			.map((line) => (applyOutputColor ? theme.fg("toolOutput", line) : line));
		return {
			lines: displayLines.length > 0 ? displayLines : [theme.fg("dim", "(no output)")],
			remaining: Math.max(0, totalLines.length - maxLines),
		};
	}

	private getPreviewNotice(remaining: number): string[] {
		if (remaining <= 0) {
			return [];
		}
		return [`${theme.fg("dim", `… ${remaining} more lines`)} (${keyHint("expandTools", "to expand")})`];
	}

	private getReadTruncationNotices(): string[] {
		const truncation = this.result?.details?.truncation;
		if (!truncation?.truncated) {
			return [];
		}
		if (truncation.firstLineExceedsLimit) {
			return [
				theme.fg("warning", `[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`),
			];
		}
		if (truncation.truncatedBy === "lines") {
			return [
				theme.fg(
					"warning",
					`[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`,
				),
			];
		}
		return [
			theme.fg(
				"warning",
				`[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`,
			),
		];
	}

	private getListNotices(): string[] {
		if (!this.result) {
			return [];
		}
		const notices: string[] = [];
		if (this.toolName === "ls" && this.result.details?.entryLimitReached) {
			notices.push(theme.fg("warning", `[Truncated: ${this.result.details.entryLimitReached} entries limit]`));
		}
		if (this.toolName === "find" && this.result.details?.resultLimitReached) {
			notices.push(theme.fg("warning", `[Truncated: ${this.result.details.resultLimitReached} results limit]`));
		}
		if (this.toolName === "grep") {
			if (this.result.details?.matchLimitReached) {
				notices.push(theme.fg("warning", `[Truncated: ${this.result.details.matchLimitReached} matches limit]`));
			}
			if (this.result.details?.linesTruncated) {
				notices.push(theme.fg("warning", "[Some lines were truncated]"));
			}
		}
		const truncation = this.result.details?.truncation;
		if (truncation?.truncated) {
			notices.push(
				theme.fg("warning", `[Output limited to ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)}]`),
			);
		}
		return notices;
	}

	private getBashNotices(): string[] {
		if (!this.result) {
			return [];
		}
		const notices: string[] = [];
		const truncation = this.result.details?.truncation;
		const fullOutputPath = this.result.details?.fullOutputPath;
		if (this.result.isError && typeof this.result.details?.exitCode === "number") {
			notices.push(theme.fg("error", `(exit ${this.result.details.exitCode})`));
		}
		if (fullOutputPath) {
			notices.push(theme.fg("warning", `Full output: ${fullOutputPath}`));
		}
		if (truncation?.truncated) {
			if (truncation.truncatedBy === "lines") {
				notices.push(
					theme.fg("warning", `Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`),
				);
			} else {
				notices.push(
					theme.fg(
						"warning",
						`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
					),
				);
			}
		}
		return notices;
	}

	private formatInlineArgsPreview(): string {
		if (!this.args || typeof this.args !== "object") {
			return "";
		}
		const entries = Object.entries(this.args as Record<string, unknown>).slice(0, 3);
		return entries
			.map(([key, value]) => {
				if (typeof value === "string") {
					return `${key}=${truncateToWidth(value, 24)}`;
				}
				if (typeof value === "number" || typeof value === "boolean") {
					return `${key}=${String(value)}`;
				}
				return key;
			})
			.join(" · ");
	}

	private getTextOutput(): string {
		if (!this.result) return "";

		const textBlocks = this.result.content?.filter((c: any) => c.type === "text") || [];
		const imageBlocks = this.result.content?.filter((c: any) => c.type === "image") || [];

		let output = textBlocks
			.map((c: any) => {
				// Use sanitizeBinaryOutput to handle binary data that crashes string-width
				return sanitizeBinaryOutput(stripAnsi(c.text || "")).replace(/\r/g, "");
			})
			.join("\n");

		const caps = getCapabilities();
		if (imageBlocks.length > 0 && (!caps.images || !this.showImages)) {
			const imageIndicators = imageBlocks
				.map((img: any) => {
					const dims = img.data ? (getImageDimensions(img.data, img.mimeType) ?? undefined) : undefined;
					return imageFallback(img.mimeType, dims);
				})
				.join("\n");
			output = output ? `${output}\n${imageIndicators}` : imageIndicators;
		}

		return output;
	}

	private formatToolExecution(): string {
		let text = "";
		const invalidArg = theme.fg("error", "[invalid arg]");

		if (this.toolName === "read") {
			const rawPath = str(this.args?.file_path ?? this.args?.path);
			const path = rawPath !== null ? shortenPath(rawPath) : null;
			const offset = this.args?.offset;
			const limit = this.args?.limit;

			let pathDisplay = path === null ? invalidArg : path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				pathDisplay += theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}

			text = `${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}`;

			if (this.result) {
				const output = this.getTextOutput();
				const rawPath = str(this.args?.file_path ?? this.args?.path);
				const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
				const lines = lang ? highlightCode(replaceTabs(output), lang) : output.split("\n");

				const maxLines = this.expanded ? lines.length : 10;
				const displayLines = lines.slice(0, maxLines);
				const remaining = lines.length - maxLines;

				text +=
					"\n\n" +
					displayLines
						.map((line: string) => (lang ? replaceTabs(line) : theme.fg("toolOutput", replaceTabs(line))))
						.join("\n");
				if (remaining > 0) {
					text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("expandTools", "to expand")})`;
				}

				const truncation = this.result.details?.truncation;
				if (truncation?.truncated) {
					if (truncation.firstLineExceedsLimit) {
						text +=
							"\n" +
							theme.fg(
								"warning",
								`[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`,
							);
					} else if (truncation.truncatedBy === "lines") {
						text +=
							"\n" +
							theme.fg(
								"warning",
								`[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`,
							);
					} else {
						text +=
							"\n" +
							theme.fg(
								"warning",
								`[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`,
							);
					}
				}
			}
		} else if (this.toolName === "write") {
			const rawPath = str(this.args?.file_path ?? this.args?.path);
			const fileContent = str(this.args?.content);
			const path = rawPath !== null ? shortenPath(rawPath) : null;

			text =
				theme.fg("toolTitle", theme.bold("write")) +
				" " +
				(path === null ? invalidArg : path ? theme.fg("accent", path) : theme.fg("toolOutput", "..."));

			if (fileContent === null) {
				text += `\n\n${theme.fg("error", "[invalid content arg - expected string]")}`;
			} else if (fileContent) {
				const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;

				let lines: string[];
				if (lang) {
					const cache = this.writeHighlightCache;
					if (cache && cache.lang === lang && cache.rawPath === rawPath && cache.rawContent === fileContent) {
						lines = cache.highlightedLines;
					} else {
						const normalized = replaceTabs(fileContent);
						lines = highlightCode(normalized, lang);
						this.writeHighlightCache = {
							rawPath,
							lang,
							rawContent: fileContent,
							normalizedLines: normalized.split("\n"),
							highlightedLines: lines,
						};
					}
				} else {
					lines = fileContent.split("\n");
					this.writeHighlightCache = undefined;
				}

				const totalLines = lines.length;
				const maxLines = this.expanded ? lines.length : 10;
				const displayLines = lines.slice(0, maxLines);
				const remaining = lines.length - maxLines;

				text +=
					"\n\n" +
					displayLines.map((line: string) => (lang ? line : theme.fg("toolOutput", replaceTabs(line)))).join("\n");
				if (remaining > 0) {
					text +=
						theme.fg("muted", `\n... (${remaining} more lines, ${totalLines} total,`) +
						` ${keyHint("expandTools", "to expand")})`;
				}
			}

			// Show error if tool execution failed
			if (this.result?.isError) {
				const errorText = this.getTextOutput();
				if (errorText) {
					text += `\n\n${theme.fg("error", errorText)}`;
				}
			}
		} else if (this.toolName === "edit") {
			const rawPath = str(this.args?.file_path ?? this.args?.path);
			const path = rawPath !== null ? shortenPath(rawPath) : null;

			// Build path display, appending :line if we have diff info
			let pathDisplay = path === null ? invalidArg : path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			const firstChangedLine =
				(this.editDiffPreview && "firstChangedLine" in this.editDiffPreview
					? this.editDiffPreview.firstChangedLine
					: undefined) ||
				(this.result && !this.result.isError ? this.result.details?.firstChangedLine : undefined);
			if (firstChangedLine) {
				pathDisplay += theme.fg("warning", `:${firstChangedLine}`);
			}

			text = `${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`;

			if (this.result?.isError) {
				// Show error from result
				const errorText = this.getTextOutput();
				if (errorText) {
					text += `\n\n${theme.fg("error", errorText)}`;
				}
			} else if (this.result?.details?.diff) {
				// Tool executed successfully - use the diff from result
				// This takes priority over editDiffPreview which may have a stale error
				// due to race condition (async preview computed after file was modified)
				text += `\n\n${renderDiff(this.result.details.diff, { filePath: rawPath ?? undefined })}`;
			} else if (this.editDiffPreview) {
				// Use cached diff preview (before tool executes)
				if ("error" in this.editDiffPreview) {
					text += `\n\n${theme.fg("error", this.editDiffPreview.error)}`;
				} else if (this.editDiffPreview.diff) {
					text += `\n\n${renderDiff(this.editDiffPreview.diff, { filePath: rawPath ?? undefined })}`;
				}
			}
		} else if (this.toolName === "ls") {
			const rawPath = str(this.args?.path);
			const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
			const limit = this.args?.limit;

			text = `${theme.fg("toolTitle", theme.bold("ls"))} ${path === null ? invalidArg : theme.fg("accent", path)}`;
			if (limit !== undefined) {
				text += theme.fg("toolOutput", ` (limit ${limit})`);
			}

			if (this.result) {
				const output = this.getTextOutput().trim();
				if (output) {
					const lines = output.split("\n");
					const maxLines = this.expanded ? lines.length : 20;
					const displayLines = lines.slice(0, maxLines);
					const remaining = lines.length - maxLines;

					text += `\n\n${displayLines.map((line: string) => theme.fg("toolOutput", line)).join("\n")}`;
					if (remaining > 0) {
						text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("expandTools", "to expand")})`;
					}
				}

				const entryLimit = this.result.details?.entryLimitReached;
				const truncation = this.result.details?.truncation;
				if (entryLimit || truncation?.truncated) {
					const warnings: string[] = [];
					if (entryLimit) {
						warnings.push(`${entryLimit} entries limit`);
					}
					if (truncation?.truncated) {
						warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					}
					text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
				}
			}
		} else if (this.toolName === "find") {
			const pattern = str(this.args?.pattern);
			const rawPath = str(this.args?.path);
			const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
			const limit = this.args?.limit;

			text =
				theme.fg("toolTitle", theme.bold("find")) +
				" " +
				(pattern === null ? invalidArg : theme.fg("accent", pattern || "")) +
				theme.fg("toolOutput", ` in ${path === null ? invalidArg : path}`);
			if (limit !== undefined) {
				text += theme.fg("toolOutput", ` (limit ${limit})`);
			}

			if (this.result) {
				const output = this.getTextOutput().trim();
				if (output) {
					const lines = output.split("\n");
					const maxLines = this.expanded ? lines.length : 20;
					const displayLines = lines.slice(0, maxLines);
					const remaining = lines.length - maxLines;

					text += `\n\n${displayLines.map((line: string) => theme.fg("toolOutput", line)).join("\n")}`;
					if (remaining > 0) {
						text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("expandTools", "to expand")})`;
					}
				}

				const resultLimit = this.result.details?.resultLimitReached;
				const truncation = this.result.details?.truncation;
				if (resultLimit || truncation?.truncated) {
					const warnings: string[] = [];
					if (resultLimit) {
						warnings.push(`${resultLimit} results limit`);
					}
					if (truncation?.truncated) {
						warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					}
					text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
				}
			}
		} else if (this.toolName === "grep") {
			const pattern = str(this.args?.pattern);
			const rawPath = str(this.args?.path);
			const path = rawPath !== null ? shortenPath(rawPath || ".") : null;
			const glob = str(this.args?.glob);
			const limit = this.args?.limit;

			text =
				theme.fg("toolTitle", theme.bold("grep")) +
				" " +
				(pattern === null ? invalidArg : theme.fg("accent", `/${pattern || ""}/`)) +
				theme.fg("toolOutput", ` in ${path === null ? invalidArg : path}`);
			if (glob) {
				text += theme.fg("toolOutput", ` (${glob})`);
			}
			if (limit !== undefined) {
				text += theme.fg("toolOutput", ` limit ${limit}`);
			}

			if (this.result) {
				const output = this.getTextOutput().trim();
				if (output) {
					const lines = output.split("\n");
					const maxLines = this.expanded ? lines.length : 15;
					const displayLines = lines.slice(0, maxLines);
					const remaining = lines.length - maxLines;

					text += `\n\n${displayLines.map((line: string) => theme.fg("toolOutput", line)).join("\n")}`;
					if (remaining > 0) {
						text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("expandTools", "to expand")})`;
					}
				}

				const matchLimit = this.result.details?.matchLimitReached;
				const truncation = this.result.details?.truncation;
				const linesTruncated = this.result.details?.linesTruncated;
				if (matchLimit || truncation?.truncated || linesTruncated) {
					const warnings: string[] = [];
					if (matchLimit) {
						warnings.push(`${matchLimit} matches limit`);
					}
					if (truncation?.truncated) {
						warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
					}
					if (linesTruncated) {
						warnings.push("some lines truncated");
					}
					text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
				}
			}
		} else {
			// Generic tool (shouldn't reach here for custom tools)
			text = theme.fg("toolTitle", theme.bold(this.toolName));

			const content = JSON.stringify(this.args, null, 2);
			text += `\n\n${content}`;
			const output = this.getTextOutput();
			if (output) {
				text += `\n${output}`;
			}
		}

		return text;
	}
}
