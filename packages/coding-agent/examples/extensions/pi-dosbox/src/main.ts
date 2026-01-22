#!/usr/bin/env npx tsx
/**
 * Standalone DOSBox TUI app
 *
 * Usage: npx tsx src/main.ts [bundle.jsdos]
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ProcessTerminal, TUI } from "@mariozechner/pi-tui";
import { DosboxComponent } from "./dosbox-component.js";

async function main() {
	const bundlePath = process.argv[2];
	let bundleData: Uint8Array | undefined;

	if (bundlePath) {
		try {
			const resolvedPath = resolve(process.cwd(), bundlePath);
			bundleData = await readFile(resolvedPath);
			console.log(`Loading bundle: ${resolvedPath}`);
		} catch (error) {
			console.error(`Failed to load bundle: ${error instanceof Error ? error.message : String(error)}`);
			process.exit(1);
		}
	}

	const terminal = new ProcessTerminal();
	const tui = new TUI(terminal);

	const fallbackColor = (s: string) => `\x1b[33m${s}\x1b[0m`;

	const component = new DosboxComponent(
		tui,
		fallbackColor,
		() => {
			tui.stop();
			process.exit(0);
		},
		bundleData,
	);

	tui.addChild(component);
	tui.setFocus(component);
	tui.start();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
