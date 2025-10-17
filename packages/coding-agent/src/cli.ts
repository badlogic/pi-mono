#!/usr/bin/env node

import { main } from "./main.js";

main(process.argv.slice(2)).catch((err) => {
	console.error(err);
	process.exit(1);
});
