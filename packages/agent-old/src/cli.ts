#!/usr/bin/env node

import { main } from "./main.js";

// Run as CLI - this file should always be executed, not imported
main(process.argv.slice(2)).catch((err) => {
	console.error(err);
	process.exit(1);
});
