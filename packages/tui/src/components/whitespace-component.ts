import { type Component, type ComponentRenderResult, getNextComponentId } from "../tui.js";

/**
 * A simple component that renders blank lines for spacing
 */
export class WhitespaceComponent implements Component {
	readonly id = getNextComponentId();
	private lines: string[] = [];
	private lineCount: number;
	private firstRender: boolean = true;

	constructor(lineCount: number = 1) {
		this.lineCount = Math.max(0, lineCount); // Ensure non-negative
		this.lines = new Array(this.lineCount).fill("");
	}

	render(_width: number): ComponentRenderResult {
		const result = {
			lines: this.lines,
			changed: this.firstRender,
		};
		this.firstRender = false;
		return result;
	}
}
