import { createRequire } from "module";

export type ClipboardModule = {
	hasImage: () => boolean;
	getImageBinary: () => Promise<Array<number>>;
};

const require = createRequire(import.meta.url);
let clipboard: ClipboardModule | null = null;

const hasDisplay = process.platform !== "linux" || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

if (!process.env.TERMUX_VERSION && hasDisplay) {
	try {
		clipboard = require("@mariozechner/clipboard") as ClipboardModule;
	} catch {
		clipboard = null;
	}
}

export { clipboard };
