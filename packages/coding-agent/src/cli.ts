#!/usr/bin/env node

// Suppress punycode deprecation warning from dependencies
// This warning comes from old dependencies still using the deprecated punycode module
const originalEmit = process.emit;
// @ts-expect-error - Monkey-patch emit to filter warnings
process.emit = (event, ...args) => {
	if (event === "warning") {
		const warning = args[0] as any;
		if (warning?.name === "DeprecationWarning" && warning?.code === "DEP0040") {
			return false; // Suppress punycode deprecation
		}
	}
	// @ts-expect-error - Call original with event and args
	return originalEmit.apply(process, [event, ...args]);
};

import { main } from "./main.js";

main(process.argv.slice(2)).catch((err) => {
	console.error(err);
	process.exit(1);
});
