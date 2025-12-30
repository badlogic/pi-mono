import type { ContextPatchOp, ContextTransformDisplay } from "@mariozechner/pi-agent-core";
import type { Component } from "@mariozechner/pi-tui";
import { Box, Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import type { ContextTransformRenderer } from "../../../core/hooks/types.js";
import type { ContextTransformMessage } from "../../../core/messages.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";

export class ContextTransformMessageComponent extends Container {
	private message: ContextTransformMessage;
	private renderer?: ContextTransformRenderer;
	private box: Box;
	private customComponent?: Component;
	private _expanded = false;

	constructor(message: ContextTransformMessage, renderer?: ContextTransformRenderer) {
		super();
		this.message = message;
		this.renderer = renderer;

		this.addChild(new Spacer(1));
		this.box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded !== expanded) {
			this._expanded = expanded;
			this.rebuild();
		}
	}

	private rebuild(): void {
		if (this.customComponent) {
			this.removeChild(this.customComponent);
			this.customComponent = undefined;
		}
		this.removeChild(this.box);

		const display: ContextTransformDisplay | undefined = this.message.display;

		if (display?.rendererId && this.renderer) {
			try {
				const component = this.renderer(
					{
						transformerName: this.message.transformerName,
						display,
						patch: this.message.patch,
						timestamp: new Date(this.message.timestamp).toISOString(),
						id: this.message.transformEntryId,
						parentId: null,
					},
					{ expanded: this._expanded },
					theme,
				);
				if (component) {
					this.customComponent = component;
					this.addChild(component);
					return;
				}
			} catch {
				// fall back to default rendering
			}
		}

		this.addChild(this.box);
		this.box.clear();

		const title = display?.title ?? this.message.transformerName;
		const summary = display?.summary;

		const label = theme.fg("customMessageLabel", `\x1b[1m[context]\x1b[22m ${title}`);
		this.box.addChild(new Text(label, 0, 0));
		if (summary) {
			this.box.addChild(new Text(theme.fg("dim", summary), 0, 0));
		}
		this.box.addChild(new Spacer(1));

		let body = display?.markdown;
		if (!body) {
			body = `\`\`\`json\n${JSON.stringify(this.message.patch satisfies ContextPatchOp[], null, 2)}\n\`\`\``;
		}

		if (!this._expanded) {
			const lines = body.split("\n");
			if (lines.length > 8) {
				body = `${lines.slice(0, 8).join("\n")}\n...`;
			}
		}

		this.box.addChild(
			new Markdown(body, 0, 0, getMarkdownTheme(), {
				color: (text: string) => theme.fg("customMessageText", text),
			}),
		);
	}
}
