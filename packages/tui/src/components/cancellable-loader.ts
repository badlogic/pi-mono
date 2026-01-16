import { getEditorKeybindings } from "../keybindings.js";
import { Loader } from "./loader.js";

/**
 * Loader that can be cancelled with Escape.
 * Extends Loader with an AbortSignal for cancelling async operations.
 *
 * @example
 * const loader = new CancellableLoader(tui, cyan, dim, "Working...");
 * loader.onAbort = () => done(null);
 * doWork(loader.signal).then(done);
 */
export class CancellableLoader extends Loader {
	private abortController = new AbortController();

	/** Called when user presses Escape */
	onAbort?: () => void;

	/** AbortSignal that is aborted when user presses Escape */
	get signal(): AbortSignal {
		return this.abortController.signal;
	}

	/** Whether the loader was aborted */
	get aborted(): boolean {
		return this.abortController.signal.aborted;
	}

	handleInput(data: string): void {
		const kb = getEditorKeybindings();
		if (kb.matches(data, "selectCancel")) {
			this.abortController.abort();
			this.onAbort?.();
		}
	}

	dispose(): void {
		this.stop();
	}
}
