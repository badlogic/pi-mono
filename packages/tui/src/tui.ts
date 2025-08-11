import process from "process";
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
	public children: (Component | Container)[] = [];
	private tui?: TUI;
	private previousChildCount: number = 0;

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

		// Check if the number of children changed (important for detecting clears)
		if (this.children.length !== this.previousChildCount) {
			changed = true;
			this.previousChildCount = this.children.length;
		}

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

		// Trigger initial render if we have components
		if (this.children.length > 0) {
			this.requestRender();
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
			this.renderLineBased(currentRenderCommands, termHeight);
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
	}

	private renderLineBased(currentCommands: RenderCommand[], termHeight: number): void {
		const viewportHeight = termHeight - 1; // Leave one line for cursor

		// Build the new lines array
		const newLines: string[] = [];
		for (const command of currentCommands) {
			newLines.push(...command.lines);
		}

		const totalNewLines = newLines.length;
		const totalOldLines = this.previousLines.length;

		// Find first changed line by comparing old and new
		let firstChangedLine = -1;
		const minLines = Math.min(totalOldLines, totalNewLines);

		for (let i = 0; i < minLines; i++) {
			if (this.previousLines[i] !== newLines[i]) {
				firstChangedLine = i;
				break;
			}
		}

		// If all common lines are the same, check if we have different lengths
		if (firstChangedLine === -1 && totalOldLines !== totalNewLines) {
			firstChangedLine = minLines;
		}

		// No changes at all
		if (firstChangedLine === -1) {
			this.previousLines = newLines;
			return;
		}

		// Calculate viewport boundaries
		const oldViewportStart = Math.max(0, totalOldLines - viewportHeight);
		const cursorPosition = totalOldLines; // Cursor is one line below last content

		let output = "";
		let linesRedrawn = 0;

		// Check if change is in scrollback (unreachable by cursor)
		if (firstChangedLine < oldViewportStart) {
			// Must do full clear and re-render
			output = "\x1b[3J\x1b[H"; // Clear scrollback and screen, home cursor

			for (let i = 0; i < newLines.length; i++) {
				if (i > 0) output += "\r\n";
				output += newLines[i];
			}

			if (newLines.length > 0) output += "\r\n";
			linesRedrawn = newLines.length;
		} else {
			// Change is in viewport - we can reach it with cursor movements
			// Calculate viewport position of the change
			const viewportChangePosition = firstChangedLine - oldViewportStart;

			// Move cursor to the change position
			const linesToMoveUp = cursorPosition - oldViewportStart - viewportChangePosition;
			if (linesToMoveUp > 0) {
				output += `\x1b[${linesToMoveUp}A`;
			}

			// Now do surgical updates or partial clear based on what's more efficient
			let currentLine = firstChangedLine;
			const currentViewportLine = viewportChangePosition;

			// If we have significant structural changes, just clear and re-render from here
			const hasSignificantChanges = totalNewLines !== totalOldLines || totalNewLines - firstChangedLine > 10; // Arbitrary threshold

			if (hasSignificantChanges) {
				// Clear from cursor to end of screen and render all remaining lines
				output += "\r\x1b[0J";

				for (let i = firstChangedLine; i < newLines.length; i++) {
					if (i > firstChangedLine) output += "\r\n";
					output += newLines[i];
					linesRedrawn++;
				}

				if (newLines.length > firstChangedLine) output += "\r\n";
			} else {
				// Do surgical line-by-line updates
				for (let i = firstChangedLine; i < minLines; i++) {
					if (this.previousLines[i] !== newLines[i]) {
						// Move to this line if needed
						const moveLines = i - currentLine;
						if (moveLines > 0) {
							output += `\x1b[${moveLines}B`;
						}

						// Clear and rewrite the line
						output += "\r\x1b[2K" + newLines[i];
						currentLine = i;
						linesRedrawn++;
					}
				}

				// Handle added/removed lines at the end
				if (totalNewLines > totalOldLines) {
					// Move to end of old content and add new lines
					const moveToEnd = totalOldLines - 1 - currentLine;
					if (moveToEnd > 0) {
						output += `\x1b[${moveToEnd}B`;
					}
					output += "\r\n";

					for (let i = totalOldLines; i < totalNewLines; i++) {
						if (i > totalOldLines) output += "\r\n";
						output += newLines[i];
						linesRedrawn++;
					}
					output += "\r\n";
				} else if (totalNewLines < totalOldLines) {
					// Move to end of new content and clear rest
					const moveToEnd = totalNewLines - 1 - currentLine;
					if (moveToEnd > 0) {
						output += `\x1b[${moveToEnd}B`;
					} else if (moveToEnd < 0) {
						output += `\x1b[${-moveToEnd}A`;
					}
					output += "\r\n\x1b[0J";
				} else {
					// Same length, just position cursor at end
					const moveToEnd = totalNewLines - 1 - currentLine;
					if (moveToEnd > 0) {
						output += `\x1b[${moveToEnd}B`;
					} else if (moveToEnd < 0) {
						output += `\x1b[${-moveToEnd}A`;
					}
					output += "\r\n";
				}
			}
		}

		this.terminal.write(output);
		this.previousLines = newLines;
		this.totalLinesRedrawn += linesRedrawn;
	}

	private handleResize(): void {
		// Clear screen and reset
		this.terminal.write("\x1b[2J\x1b[H\x1b[?25l");
		this.renderToScreen(true);
	}

	private handleKeypress(data: string): void {
		if (this.onGlobalKeyPress) {
			const shouldForward = this.onGlobalKeyPress(data);
			if (!shouldForward) {
				this.requestRender();
				return;
			}
		}

		if (this.focusedComponent?.handleInput) {
			this.focusedComponent.handleInput(data);
			this.requestRender();
		}
	}
}
