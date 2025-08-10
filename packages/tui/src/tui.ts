import process from "process";
import { logger } from "./logger.js";
import { ProcessTerminal, type Terminal } from "./terminal.js";

/**
 * Result of rendering a component
 */
export interface ComponentRenderResult {
	lines: string[];
	changed: boolean;
}

/**
 * Component interface
 */
export interface Component {
	readonly id: number;
	render(width: number): ComponentRenderResult;
	handleInput?(keyData: string): void;
}

// Global component ID counter
let nextComponentId = 1;

// Helper to get next component ID
export function getNextComponentId(): number {
	return nextComponentId++;
}

// Padding type for components
export interface Padding {
	top?: number;
	bottom?: number;
	left?: number;
	right?: number;
}

/**
 * Container for managing child components
 */
export class Container implements Component {
	readonly id: number;
	protected children: (Component | Container)[] = [];
	private tui?: TUI;

	constructor() {
		this.id = getNextComponentId();
	}

	setTui(tui: TUI | undefined): void {
		this.tui = tui;
		for (const child of this.children) {
			if (child instanceof Container) {
				child.setTui(tui);
			}
		}
	}

	addChild(component: Component | Container): void {
		this.children.push(component);
		if (component instanceof Container) {
			component.setTui(this.tui);
		}
		this.tui?.requestRender();
	}

	removeChild(component: Component | Container): void {
		const index = this.children.indexOf(component);
		if (index >= 0) {
			this.children.splice(index, 1);
			if (component instanceof Container) {
				component.setTui(undefined);
			}
			this.tui?.requestRender();
		}
	}

	removeChildAt(index: number): void {
		if (index >= 0 && index < this.children.length) {
			const component = this.children[index];
			this.children.splice(index, 1);
			if (component instanceof Container) {
				component.setTui(undefined);
			}
			this.tui?.requestRender();
		}
	}

	clear(): void {
		for (const child of this.children) {
			if (child instanceof Container) {
				child.setTui(undefined);
			}
		}
		this.children = [];
		this.tui?.requestRender();
	}

	getChild(index: number): (Component | Container) | undefined {
		return this.children[index];
	}

	getChildCount(): number {
		return this.children.length;
	}

	render(width: number): ComponentRenderResult {
		const lines: string[] = [];
		let changed = false;

		for (const child of this.children) {
			const result = child.render(width);
			lines.push(...result.lines);
			if (result.changed) {
				changed = true;
			}
		}

		return { lines, changed };
	}
}

/**
 * Render command for tracking component output
 */
interface RenderCommand {
	id: number;
	lines: string[];
	changed: boolean;
}

/**
 * TUI - Smart differential rendering TUI implementation.
 */
export class TUI extends Container {
	private focusedComponent: Component | null = null;
	private needsRender = false;
	private isFirstRender = true;
	private isStarted = false;
	public onGlobalKeyPress?: (data: string) => boolean;
	private terminal: Terminal;

	// Tracking for differential rendering
	private previousRenderCommands: RenderCommand[] = [];
	private previousLines: string[] = []; // What we rendered last time

	// Performance metrics
	private totalLinesRedrawn = 0;
	private renderCount = 0;
	public getLinesRedrawn(): number {
		return this.totalLinesRedrawn;
	}
	public getAverageLinesRedrawn(): number {
		return this.renderCount > 0 ? this.totalLinesRedrawn / this.renderCount : 0;
	}

	constructor(terminal?: Terminal) {
		super();
		this.setTui(this);
		this.handleResize = this.handleResize.bind(this);
		this.handleKeypress = this.handleKeypress.bind(this);

		// Use provided terminal or default to ProcessTerminal
		this.terminal = terminal || new ProcessTerminal();

		logger.componentLifecycle("TUI", "created");
	}

	configureLogging(config: Parameters<typeof logger.configure>[0]): void {
		logger.configure(config);
		logger.info("TUI", "Logging configured", config);
	}

	setFocus(component: Component): void {
		if (this.findComponent(component)) {
			this.focusedComponent = component;
		}
	}

	private findComponent(component: Component): boolean {
		if (this.children.includes(component)) {
			return true;
		}

		for (const child of this.children) {
			if (child instanceof Container) {
				if (this.findInContainer(child, component)) {
					return true;
				}
			}
		}

		return false;
	}

	private findInContainer(container: Container, component: Component): boolean {
		const childCount = container.getChildCount();

		for (let i = 0; i < childCount; i++) {
			const child = container.getChild(i);
			if (child === component) {
				return true;
			}
			if (child instanceof Container) {
				if (this.findInContainer(child, component)) {
					return true;
				}
			}
		}

		return false;
	}

	requestRender(): void {
		if (!this.isStarted) return;

		// Only queue a render if we haven't already
		if (!this.needsRender) {
			this.needsRender = true;
			process.nextTick(() => {
				if (this.needsRender) {
					this.renderToScreen();
					this.needsRender = false;
				}
			});
		}
	}

	start(): void {
		this.isStarted = true;

		// Hide cursor
		this.terminal.write("\x1b[?25l");

		// Start terminal with handlers
		try {
			this.terminal.start(this.handleKeypress, this.handleResize);
		} catch (error) {
			console.error("Error starting terminal:", error);
		}
	}

	stop(): void {
		// Show cursor
		this.terminal.write("\x1b[?25h");

		// Stop terminal
		this.terminal.stop();

		this.isStarted = false;
	}

	private renderToScreen(resize = false): void {
		const termWidth = this.terminal.columns;
		const termHeight = this.terminal.rows;

		if (resize) {
			this.isFirstRender = true;
			this.previousRenderCommands = [];
			this.previousLines = [];
		}

		// Collect all render commands
		const currentRenderCommands: RenderCommand[] = [];
		this.collectRenderCommands(this, termWidth, currentRenderCommands);

		if (this.isFirstRender) {
			this.renderInitial(currentRenderCommands);
			this.isFirstRender = false;
		} else {
			// this.executeDifferentialRender(currentRenderCommands, termHeight);
			this.renderDifferential(currentRenderCommands, termHeight);
		}

		// Save for next render
		this.previousRenderCommands = currentRenderCommands;
		this.renderCount++;
	}

	private collectRenderCommands(container: Container, width: number, commands: RenderCommand[]): void {
		const childCount = container.getChildCount();

		for (let i = 0; i < childCount; i++) {
			const child = container.getChild(i);
			if (!child) continue;

			const result = child.render(width);
			commands.push({
				id: child.id,
				lines: result.lines,
				changed: result.changed,
			});
		}
	}

	private renderInitial(commands: RenderCommand[]): void {
		let output = "";
		const lines: string[] = [];

		for (const command of commands) {
			lines.push(...command.lines);
		}

		// Output all lines
		for (let i = 0; i < lines.length; i++) {
			if (i > 0) output += "\r\n";
			output += lines[i];
		}

		// Add final newline to position cursor below content
		if (lines.length > 0) output += "\r\n";

		this.terminal.write(output);

		// Save what we rendered
		this.previousLines = lines;
		this.totalLinesRedrawn += lines.length;

		logger.debug("TUI", "Initial render", {
			commandsExecuted: commands.length,
			linesRendered: lines.length,
		});
	}

	private renderDifferential(currentCommands: RenderCommand[], termHeight: number): void {
		const viewportHeight = termHeight - 1; // Leave one line for cursor

		// Build the new lines array
		const newLines: string[] = [];
		for (const command of currentCommands) {
			newLines.push(...command.lines);
		}

		const totalNewLines = newLines.length;
		const totalOldLines = this.previousLines.length;

		// Find the first line that changed
		let firstChangedLineOffset = -1;
		let currentLineOffset = 0;

		for (let i = 0; i < currentCommands.length; i++) {
			const current = currentCommands[i];
			const previous = i < this.previousRenderCommands.length ? this.previousRenderCommands[i] : null;

			// Check if this is a new component or component was removed/reordered
			if (!previous || previous.id !== current.id) {
				firstChangedLineOffset = currentLineOffset;
				break;
			}

			// Check if component content or size changed
			if (current.changed) {
				firstChangedLineOffset = currentLineOffset;
				break;
			}

			currentLineOffset += current.lines.length;
		}

		// Also check if we have fewer components now (components removed from end)
		if (firstChangedLineOffset === -1 && currentCommands.length < this.previousRenderCommands.length) {
			firstChangedLineOffset = currentLineOffset;
		}

		// If nothing changed, do nothing
		if (firstChangedLineOffset === -1) {
			this.previousLines = newLines;
			return;
		}

		// Calculate where the first change is relative to the viewport
		// If our content exceeds viewport, some is in scrollback
		const contentStartInViewport = Math.max(0, totalOldLines - viewportHeight);
		const changePositionInViewport = firstChangedLineOffset - contentStartInViewport;

		let output = "";
		let linesRedrawn = 0;

		if (changePositionInViewport < 0) {
			// The change is above the viewport - we cannot reach it with cursor
			// MUST do full re-render
			output = "\x1b[3J\x1b[H"; // Clear scrollback and screen, then home cursor

			// Render ALL lines
			for (let i = 0; i < newLines.length; i++) {
				if (i > 0) output += "\r\n";
				output += newLines[i];
			}

			// Add final newline
			if (newLines.length > 0) output += "\r\n";

			linesRedrawn = newLines.length;
		} else {
			// The change is in the viewport - we can update from there
			// Calculate how many lines up to move from current cursor position
			const linesToMoveUp = totalOldLines - firstChangedLineOffset;

			if (linesToMoveUp > 0) {
				output += `\x1b[${linesToMoveUp}A`;
			}

			// Clear from here to end of screen
			output += "\x1b[0J";

			// Render everything from the first change onwards
			const linesToRender = newLines.slice(firstChangedLineOffset);
			for (let i = 0; i < linesToRender.length; i++) {
				if (i > 0) output += "\r\n";
				output += linesToRender[i];
			}

			// Add final newline
			if (linesToRender.length > 0) output += "\r\n";

			linesRedrawn = linesToRender.length;
		}

		this.terminal.write(output);

		// Save what we rendered
		this.previousLines = newLines;
		this.totalLinesRedrawn += linesRedrawn;

		logger.debug("TUI", "Differential render", {
			linesRedrawn,
			firstChangedLineOffset,
			changePositionInViewport,
			totalNewLines,
			totalOldLines,
		});
	}

	private executeDifferentialRender(currentCommands: RenderCommand[], termHeight: number): void {
		let output = "";
		let linesRedrawn = 0;
		const viewportHeight = termHeight - 1; // Leave one line for cursor

		// Build the new lines
		const newLines: string[] = [];
		for (const command of currentCommands) {
			newLines.push(...command.lines);
		}

		// Calculate total lines for both old and new
		const totalNewLines = newLines.length;
		const totalOldLines = this.previousLines.length;

		// Calculate what's visible in viewport
		const oldVisibleLines = Math.min(totalOldLines, viewportHeight);
		const newVisibleLines = Math.min(totalNewLines, viewportHeight);

		// Check if we need to do a full redraw
		let needFullRedraw = false;
		let currentLineOffset = 0;

		// Compare commands to detect structural changes
		for (let i = 0; i < currentCommands.length; i++) {
			const current = currentCommands[i];
			const previous = i < this.previousRenderCommands.length ? this.previousRenderCommands[i] : null;

			// Check if component order changed or new component
			if (!previous || previous.id !== current.id) {
				needFullRedraw = true;
				break;
			}

			// Check if component changed
			if (current.changed) {
				// Check if line count changed
				if (current.lines.length !== previous.lines.length) {
					needFullRedraw = true;
					break;
				}

				// Check if component is fully visible
				const componentEnd = currentLineOffset + current.lines.length;
				const visibleStart = Math.max(0, totalNewLines - viewportHeight);

				if (currentLineOffset < visibleStart) {
					// Component is partially or fully outside viewport
					needFullRedraw = true;
					break;
				}
			}

			currentLineOffset += current.lines.length;
		}

		if (needFullRedraw) {
			// When we need a full redraw, we must clear the entire scrollback buffer
			// and render ALL components, not just what fits in the viewport

			// Clear the entire screen and scrollback buffer
			output = "\x1b[2J\x1b[3J\x1b[H";

			// Render ALL lines, letting the terminal handle scrolling naturally
			for (let i = 0; i < newLines.length; i++) {
				if (i > 0) output += "\r\n";
				output += newLines[i];
			}

			// Add final newline to position cursor below content
			if (newLines.length > 0) output += "\r\n";

			linesRedrawn = newLines.length;
		} else {
			// We can only do differential updates for components in the viewport
			// Move cursor to top of visible content
			if (oldVisibleLines > 0) {
				output += `\x1b[${oldVisibleLines}A`;
			}

			// Do line-by-line diff for visible portion only
			const oldVisible =
				totalOldLines > viewportHeight ? this.previousLines.slice(-viewportHeight) : this.previousLines;
			const newVisible = totalNewLines > viewportHeight ? newLines.slice(-viewportHeight) : newLines;

			// Compare and update only changed lines
			const maxLines = Math.max(oldVisible.length, newVisible.length);

			for (let i = 0; i < maxLines; i++) {
				const oldLine = i < oldVisible.length ? oldVisible[i] : "";
				const newLine = i < newVisible.length ? newVisible[i] : "";

				if (i >= newVisible.length) {
					// This line no longer exists - clear it
					if (i > 0) {
						output += `\x1b[${i}B`; // Move to line i
					}
					output += "\x1b[2K"; // Clear line
					output += `\x1b[${i}A`; // Move back to top
				} else if (oldLine !== newLine) {
					// Line changed - update it
					if (i > 0) {
						output += `\x1b[${i}B`; // Move to line i
					}
					output += "\x1b[2K\r"; // Clear line and return to start
					output += newLine;
					if (i > 0) {
						output += `\x1b[${i}A`; // Move back to top
					}
					linesRedrawn++;
				}
			}

			// Move cursor to end
			output += `\x1b[${newVisible.length}B`;

			// Clear any remaining lines if we have fewer lines now
			if (newVisible.length < oldVisible.length) {
				output += "\x1b[0J";
			}
		}

		this.terminal.write(output);

		// Save what we rendered
		this.previousLines = newLines;
		this.totalLinesRedrawn += linesRedrawn;

		logger.debug("TUI", "Differential render", {
			linesRedrawn,
			needFullRedraw,
			totalNewLines,
			totalOldLines,
		});
	}

	private handleResize(): void {
		// Clear screen and reset
		this.terminal.write("\x1b[2J\x1b[H\x1b[?25l");
		this.renderToScreen(true);
	}

	private handleKeypress(data: string): void {
		logger.keyInput("TUI", data);

		if (this.onGlobalKeyPress) {
			const shouldForward = this.onGlobalKeyPress(data);
			if (!shouldForward) {
				this.requestRender();
				return;
			}
		}

		if (this.focusedComponent?.handleInput) {
			logger.debug("TUI", "Forwarding input to focused component", {
				componentType: this.focusedComponent.constructor.name,
			});
			this.focusedComponent.handleInput(data);
			this.requestRender();
		} else {
			logger.warn("TUI", "No focused component to handle input", {
				focusedComponent: this.focusedComponent?.constructor.name || "none",
				hasHandleInput: this.focusedComponent?.handleInput ? "yes" : "no",
			});
		}
	}
}
