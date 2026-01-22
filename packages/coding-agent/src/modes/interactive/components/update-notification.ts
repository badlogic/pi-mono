import { Container, Markdown, type MarkdownTheme, Spacer, Text } from "@mariozechner/pi-tui";
import { isBunBinary, isBunRuntime } from "../../../config.js";
import { getMarkdownTheme, theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { editorKey } from "./keybinding-hints.js";

/**
 * Component that renders a version update notification with collapsed/expanded state.
 * Collapsed: shows version and install command with borders
 * Expanded: shows full release notes
 */
export class UpdateNotificationComponent extends Container {
	private expanded = false;
	private newVersion: string;
	private releaseNotes: string | undefined;
	private markdownTheme: MarkdownTheme;

	constructor(newVersion: string, releaseNotes?: string, markdownTheme: MarkdownTheme = getMarkdownTheme()) {
		super();
		this.newVersion = newVersion;
		this.releaseNotes = releaseNotes;
		this.markdownTheme = markdownTheme;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private getInstallCommand(): string {
		if (isBunBinary) {
			return `Download from: ${theme.fg("accent", "https://github.com/badlogic/pi-mono/releases/latest")}`;
		}
		return `Run: ${theme.fg("accent", `${isBunRuntime ? "bun" : "npm"} install -g @mariozechner/pi-coding-agent`)}`;
	}

	private updateDisplay(): void {
		this.clear();

		const borderColor = (text: string) => theme.fg("warning", text);

		if (this.expanded && this.releaseNotes) {
			this.addChild(new DynamicBorder(borderColor));
			this.addChild(
				new Text(`${theme.bold(theme.fg("warning", "Update Available"))} — ${this.getInstallCommand()}`, 1, 0),
			);
			this.addChild(new Spacer(1));
			this.addChild(new Markdown(this.releaseNotes, 1, 0, this.markdownTheme));
			this.addChild(new Spacer(1));
			this.addChild(new DynamicBorder(borderColor));
		} else {
			const expandHint = this.releaseNotes
				? ` (${theme.fg("dim", editorKey("expandTools"))} to see what's new)`
				: "";
			this.addChild(new DynamicBorder(borderColor));
			this.addChild(
				new Text(
					`${theme.bold(theme.fg("warning", "Update Available"))}\n` +
						theme.fg("muted", `New version ${this.newVersion} is available. `) +
						this.getInstallCommand() +
						expandHint,
					1,
					0,
				),
			);
			this.addChild(new DynamicBorder(borderColor));
		}
	}
}
