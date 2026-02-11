#!/usr/bin/env node

import { chmodSync, copyFileSync, cpSync } from "node:fs";

if (process.platform !== "win32") {
	chmodSync("dist/cli.js", 0o755);
}

copyFileSync("src/models.json", "dist/models.json");
cpSync("scripts", "dist/scripts", { recursive: true });
