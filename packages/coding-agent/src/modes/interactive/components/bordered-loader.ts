import { CancellableLoader, Container, Spacer, Text, type TUI } from "@mariozechner/pi-tui";
import type { Theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

/** Loader wrapped with borders for hook UI */
export class BorderedLoader extends Container {
	private loader: CancellableLoader;

	constructor(tui: TUI, theme: Theme, message: string) {
		super();
		const borderColor = (s: string) => theme.fg("border", s);
		this.addChild(new DynamicBorder(borderColor));
		this.loader = new CancellableLoader(
			tui,
			(s) => theme.fg("accent", s),
			(s) => theme.fg("muted", s),
			message,
		);
		this.addChild(this.loader);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", "esc cancel"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(borderColor));
	}

	get signal(): AbortSignal {
		return this.loader.signal;
	}

	set onAbort(fn: (() => void) | undefined) {
		this.loader.onAbort = fn;
	}

	handleInput(data: string): void {
		this.loader.handleInput(data);
	}

	dispose(): void {
		this.loader.dispose();
	}
}
