import { createRequire } from "module";

export type ClipboardModule = {
	hasImage: () => boolean;
	getImageBinary: () => Promise<Array<number>>;
};

const require = createRequire(import.meta.url);
let clipboard: ClipboardModule | null = null;

try {
	clipboard = require("@mariozechner/clipboard") as ClipboardModule;
} catch {
	clipboard = null;
}

export { clipboard };
