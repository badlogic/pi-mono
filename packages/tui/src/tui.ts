import { writeSync } from "fs";
import process from "process";
import { logger } from "./logger.js";

export interface Padding {
	top?: number;
	bottom?: number;
	left?: number;
	right?: number;
}

export interface ComponentRenderResult {
	lines: string[];
	changed: boolean;
}

export interface ContainerRenderResult extends ComponentRenderResult {
	keepLines: number;
}

export interface Component {
	render(width: number): ComponentRenderResult;
	handleInput?(keyData: string): void;
}

// Sentinel component used to mark removed components - triggers cascade rendering
class SentinelComponent implements Component {
	render(): ComponentRenderResult {
		return {
			lines: [],
			changed: true, // Always trigger cascade
		};
	}
}

// Base Container class that manages child components
export class Container {
	protected children: Element[] = [];
	protected lines: string[] = [];
	protected parentTui: TUI | undefined; // Reference to parent TUI for triggering re-renders

	constructor(parentTui?: TUI | undefined) {
		this.parentTui = parentTui;
	}

	setParentTui(tui: TUI | undefined): void {
		this.parentTui = tui;
	}

	addChild(component: Element): void {
		this.children.push(component);

		// Set parent TUI reference for nested containers
		if (component instanceof Container && this.parentTui) {
			component.setParentTui(this.parentTui);
		}

		if (this.parentTui) {
			this.parentTui.requestRender();
		}
	}

	removeChild(component: Element): void {
		const index = this.children.indexOf(component);
		if (index >= 0) {
			// Replace with sentinel instead of splicing to maintain array structure
			this.children[index] = new SentinelComponent();
			// Keep the childTotalLines entry - sentinel will update it to 0

			// Clear parent TUI reference for nested containers
			if (component instanceof Container) {
				component.setParentTui(undefined);
			}

			// Use normal render - sentinel will trigger cascade naturally
			if (this.parentTui) {
				this.parentTui.requestRender();
			}
		} else {
			for (const child of this.children) {
				if (child instanceof Container) {
					child.removeChild(component);
				}
			}
		}
	}

	removeChildAt(index: number): void {
		if (index >= 0 && index < this.children.length) {
			const component = this.children[index];

			// Replace with sentinel instead of splicing to maintain array structure
			this.children[index] = new SentinelComponent();

			// Clear parent TUI reference for nested containers
			if (component instanceof Container) {
				component.setParentTui(undefined);
			}

			// Use normal render - sentinel will trigger cascade naturally
			if (this.parentTui) {
				this.parentTui.requestRender();
			}
		}
	}

	render(width: number): ContainerRenderResult {
		let keepLines = 0;
		let changed = false;
		const newLines: string[] = [];

		for (let i = 0; i < this.children.length; i++) {
			const child = this.children[i];
			if (!child) continue;

			if (child instanceof Container) {
				const result = child.render(width);
				newLines.push(...result.lines);
				if (!changed && !result.changed) {
					keepLines += result.lines.length;
				} else {
					if (!changed) {
						// First change - use the child's keepLines
						changed = true;
						keepLines += result.keepLines;
					}
					// After first change, don't add any more keepLines
				}
			} else {
				const result = child.render(width);
				newLines.push(...result.lines);
				if (!changed && !result.changed) {
					keepLines += result.lines.length;
				} else {
					if (!changed) {
						// First change for a non-container component
						changed = true;
					}
					// After first change, don't add any more keepLines
				}
			}
		}

		this.lines = newLines;
		return {
			lines: this.lines,
			changed,
			keepLines,
		};
	}

	// Get child for external manipulation
	// Get child at index
	// Note: This may return a SentinelComponent if a child was removed but not yet cleaned up
	getChild(index: number): Element | undefined {
		return this.children[index];
	}

	// Get number of children
	// Note: This count includes sentinel components until they are cleaned up after the next render pass
	getChildCount(): number {
		return this.children.length;
	}

	// Clear all children from the container
	clear(): void {
		// Clear parent TUI references for nested containers
		for (const child of this.children) {
			if (child instanceof Container) {
				child.setParentTui(undefined);
			}
		}

		// Clear the children array
		this.children = [];

		// Request render if we have a parent TUI
		if (this.parentTui) {
			this.parentTui.requestRender();
		}
	}

	// Clean up sentinel components
	cleanupSentinels(): void {
		const originalCount = this.children.length;
		const validChildren: Element[] = [];
		let sentinelCount = 0;

		for (const child of this.children) {
			if (child && !(child instanceof SentinelComponent)) {
				validChildren.push(child);

				// Recursively clean up nested containers
				if (child instanceof Container) {
					child.cleanupSentinels();
				}
			} else if (child instanceof SentinelComponent) {
				sentinelCount++;
			}
		}

		this.children = validChildren;

		if (sentinelCount > 0) {
			logger.debug("Container", "Cleaned up sentinels", {
				originalCount,
				newCount: this.children.length,
				sentinelsRemoved: sentinelCount,
			});
		}
	}
}

type Element = Component | Container;

export class TUI extends Container {
	private focusedComponent: Component | null = null;
	private needsRender: boolean = false;
	private wasRaw: boolean = false;
	private totalLines: number = 0;
	private isFirstRender: boolean = true;
	private isStarted: boolean = false;
	public onGlobalKeyPress?: (data: string) => boolean;

	constructor() {
		super(); // No parent TUI for root
		this.handleResize = this.handleResize.bind(this);
		this.handleKeypress = this.handleKeypress.bind(this);
		logger.componentLifecycle("TUI", "created");
	}

	configureLogging(config: Parameters<typeof logger.configure>[0]): void {
		logger.configure(config);
		logger.info("TUI", "Logging configured", config);
	}

	override addChild(component: Element): void {
		// Set parent TUI reference for containers
		if (component instanceof Container) {
			component.setParentTui(this);
		}
		super.addChild(component);

		// Only auto-render if TUI has been started
		if (this.isStarted) {
			this.requestRender();
		}
	}

	override removeChild(component: Element): void {
		super.removeChild(component);
		this.requestRender();
	}

	setFocus(component: Component): void {
		// Check if component exists anywhere in the hierarchy
		if (this.findComponent(component)) {
			this.focusedComponent = component;
		}
	}

	private findComponent(component: Component): boolean {
		// Check direct children
		if (this.children.includes(component)) {
			return true;
		}

		// Recursively search in containers
		for (const comp of this.children) {
			if (comp instanceof Container) {
				if (this.findInContainer(comp, component)) {
					return true;
				}
			}
		}

		return false;
	}

	private findInContainer(container: Container, component: Component): boolean {
		const childCount = container.getChildCount();

		// Check direct children
		for (let i = 0; i < childCount; i++) {
			const child = container.getChild(i);
			if (child === component) {
				return true;
			}
		}

		// Recursively search in nested containers
		for (let i = 0; i < childCount; i++) {
			const child = container.getChild(i);
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
		this.needsRender = true;
		// Batch renders on next tick
		process.nextTick(() => {
			if (this.needsRender) {
				this.renderToScreen();
				this.needsRender = false;
			}
		});
	}

	start(): void {
		// Set started flag
		this.isStarted = true;

		// Hide the terminal cursor
		process.stdout.write("\x1b[?25l");

		// Set up raw mode for key capture
		try {
			this.wasRaw = process.stdin.isRaw || false;
			if (process.stdin.setRawMode) {
				process.stdin.setRawMode(true);
			}
			process.stdin.setEncoding("utf8");
			process.stdin.resume();

			// Listen for events
			process.stdout.on("resize", this.handleResize);
			process.stdin.on("data", this.handleKeypress);
		} catch (error) {
			console.error("Error setting up raw mode:", error);
		}

		// Initial render
		this.renderToScreen();
	}

	stop(): void {
		// Show the terminal cursor again
		process.stdout.write("\x1b[?25h");

		process.stdin.removeListener("data", this.handleKeypress);
		process.stdout.removeListener("resize", this.handleResize);
		if (process.stdin.setRawMode) {
			process.stdin.setRawMode(this.wasRaw);
		}
	}

	private renderToScreen(resize: boolean = false): void {
		const termWidth = process.stdout.columns || 80;

		logger.debug("TUI", "Starting render cycle", {
			termWidth,
			componentCount: this.children.length,
			isFirstRender: this.isFirstRender,
		});

		const result = this.render(termWidth);

		if (resize) {
			this.totalLines = result.lines.length;
			result.keepLines = 0;
			this.isFirstRender = true;
		}

		logger.debug("TUI", "Render result", {
			totalLines: result.lines.length,
			keepLines: result.keepLines,
			changed: result.changed,
			previousTotalLines: this.totalLines,
		});

		if (!result.changed) {
			// Nothing changed - skip render
			return;
		}

		// Handle cursor positioning
		if (this.isFirstRender) {
			// First render: just append to current terminal position
			this.isFirstRender = false;
			// Output all lines normally on first render
			for (const line of result.lines) {
				console.log(line);
			}
		} else {
			// Move cursor up to start of changing content and clear down
			const linesToMoveUp = this.totalLines - result.keepLines;
			let output = "";

			logger.debug("TUI", "Cursor movement", {
				linesToMoveUp,
				totalLines: this.totalLines,
				keepLines: result.keepLines,
				changingLineCount: result.lines.length - result.keepLines,
			});

			if (linesToMoveUp > 0) {
				output += `\x1b[${linesToMoveUp}A\x1b[0J`;
			}

			// Build the output string for all changing lines
			const changingLines = result.lines.slice(result.keepLines);

			logger.debug("TUI", "Output details", {
				linesToMoveUp,
				changingLinesCount: changingLines.length,
				keepLines: result.keepLines,
				totalLines: result.lines.length,
				previousTotalLines: this.totalLines,
			});
			for (const line of changingLines) {
				output += `${line}\n`;
			}

			// Write everything at once - use synchronous write to prevent race conditions
			writeSync(process.stdout.fd, output);
		}

		this.totalLines = result.lines.length;

		// Clean up sentinels after rendering
		this.cleanupSentinels();
	}

	private handleResize(): void {
		// Clear screen, hide cursor, and reset color
		process.stdout.write("\u001Bc\x1b[?25l\u001B[3J");

		// Terminal size changed - force re-render all
		this.renderToScreen(true);
	}

	private handleKeypress(data: string): void {
		logger.keyInput("TUI", data);

		// Don't handle Ctrl+C here - let the global key handler deal with it
		// if (data.charCodeAt(0) === 3) {
		// 	logger.info("TUI", "Ctrl+C received");
		// 	return; // Don't process this key further
		// }

		// Call global key handler if set
		if (this.onGlobalKeyPress) {
			const shouldForward = this.onGlobalKeyPress(data);
			if (!shouldForward) {
				// Global handler consumed the key, don't forward to focused component
				this.requestRender();
				return;
			}
		}

		// Send input to focused component
		if (this.focusedComponent?.handleInput) {
			logger.debug("TUI", "Forwarding input to focused component", {
				componentType: this.focusedComponent.constructor.name,
			});
			this.focusedComponent.handleInput(data);
			// Trigger re-render after input
			this.requestRender();
		} else {
			logger.warn("TUI", "No focused component to handle input", {
				focusedComponent: this.focusedComponent?.constructor.name || "none",
				hasHandleInput: this.focusedComponent?.handleInput ? "yes" : "no",
			});
		}
	}
}
