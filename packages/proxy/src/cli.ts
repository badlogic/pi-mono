#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = process.argv[2] || "3001";

// Run the CORS proxy
const child = spawn("node", [path.join(__dirname, "cors-proxy.js"), port], {
	stdio: "inherit",
});

child.on("exit", (code) => {
	process.exit(code || 0);
});
