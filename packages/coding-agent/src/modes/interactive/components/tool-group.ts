import {
	type Component,
	Container,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import type { ToolExecutionComponent } from "./tool-execution.ts";

/** Group visibility never changes the output expansion state of its children. */
export class ToolGroupComponent implements Component {
	private content = new Container();
	private outputPad: number;
	expanded = false;

	constructor(outputPad = 1) {
		this.outputPad = outputPad;
	}

	get tools(): readonly ToolExecutionComponent[] {
		return this.content.children as ToolExecutionComponent[];
	}

	addTool(tool: ToolExecutionComponent, index = this.content.children.length): void {
		this.content.children.splice(index, 0, tool);
	}

	removeTool(tool: ToolExecutionComponent): void {
		this.content.removeChild(tool);
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	setToolsExpanded(expanded: boolean): void {
		for (const tool of this.tools) tool.setExpanded(expanded);
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		for (const tool of this.tools) tool.setOutputPad(padding);
	}

	setShowImages(show: boolean): void {
		for (const tool of this.tools) tool.setShowImages(show);
	}

	setImageWidthCells(width: number): void {
		for (const tool of this.tools) tool.setImageWidthCells(width);
	}

	invalidate(): void {
		this.content.invalidate();
	}

	render(width: number): string[] {
		const counts = new Map<string, number>();
		let running = 0;
		let pending = 0;
		let errors = 0;
		for (const tool of this.tools) {
			counts.set(tool.getToolName(), (counts.get(tool.getToolName()) ?? 0) + 1);
			const status = tool.getStatus();
			if (status === "running") running++;
			if (status === "pending") pending++;
			if (status === "error") errors++;
		}
		const status = [
			running ? `${running} running` : "",
			pending ? `${pending} pending` : "",
			errors ? `${errors} error${errors === 1 ? "" : "s"}` : "",
			running === 0 && pending === 0 && errors === 0 ? "done" : "",
		].filter(Boolean);
		const names = Array.from(counts, ([name, count]) => `${name} ×${count}`).join(", ");
		const summary = `${" ".repeat(this.outputPad)}${this.expanded ? "▾" : "▸"} ${this.tools.length} tool${this.tools.length === 1 ? "" : "s"} · ${[...status, names].join(" · ")}`;
		const line = truncateToWidth(theme.fg(errors ? "error" : running ? "accent" : "muted", summary), width);
		return this.expanded ? [line, ...this.content.render(width)] : [line];
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.y === 0 && event.type === "click" && event.button === "left") {
			this.setExpanded(!this.expanded);
			return { handled: true };
		}
		if (!this.expanded || event.y < 1) return undefined;
		return this.content.handleMouse({ ...event, y: event.y - 1, height: event.height - 1 });
	}
}
