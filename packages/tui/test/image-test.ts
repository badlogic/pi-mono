import { readFileSync } from "fs";
import { Image } from "../src/components/image.js";
import { Spacer } from "../src/components/spacer.js";
import { Text } from "../src/components/text.js";
import { ProcessTerminal } from "../src/terminal.js";
import { getCapabilities, getImageDimensions } from "../src/terminal-image.js";
import { TUI } from "../src/tui.js";

const testImagePath = process.argv[2] || "/tmp/test-image.png";

console.log("Terminal capabilities:", getCapabilities());
console.log("Loading image from:", testImagePath);

let imageBuffer: Buffer;
try {
	imageBuffer = readFileSync(testImagePath);
} catch (_e) {
	console.error(`Failed to load image: ${testImagePath}`);
	console.error("Usage: npx tsx test/image-test.ts [path-to-image.png]");
	process.exit(1);
}

const base64Data = imageBuffer.toString("base64");
const dims = getImageDimensions(base64Data, "image/png");

console.log("Image dimensions:", dims);
console.log("");

const terminal = new ProcessTerminal();
const tui = new TUI(terminal);

tui.addChild(new Text("Image Rendering Test", 1, 1));
tui.addChild(new Spacer(1));

if (dims) {
	tui.addChild(
		new Image(base64Data, "image/png", { fallbackColor: (s) => `\x1b[33m${s}\x1b[0m` }, { maxWidthCells: 60 }, dims),
	);
} else {
	tui.addChild(new Text("Could not parse image dimensions", 1, 0));
}

tui.addChild(new Spacer(1));
tui.addChild(new Text("Press Ctrl+C to exit", 1, 0));

const editor = {
	handleInput(data: string) {
		if (data.charCodeAt(0) === 3) {
			tui.stop();
			process.exit(0);
		}
	},
};

tui.setFocus(editor as any);
tui.start();
