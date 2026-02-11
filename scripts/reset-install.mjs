#!/usr/bin/env node

import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const safeRm = (path) => {
	try {
		rmSync(path, { recursive: true, force: true });
	} catch {
		// Best-effort cleanup before reinstall.
	}
};

const removeNodeModules = (dir) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const fullPath = join(dir, entry.name);
		if (entry.name === "node_modules") {
			safeRm(fullPath);
			continue;
		}
		removeNodeModules(fullPath);
	}
};

safeRm("node_modules");
safeRm("package-lock.json");

removeNodeModules("packages");
