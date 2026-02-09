import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createVideoElectronApp } from "./electron-main.js";

function loadEnvFile(...candidates: string[]): void {
	for (const filePath of candidates) {
		const resolved = resolve(filePath);
		if (!existsSync(resolved)) continue;

		const content = readFileSync(resolved, "utf8");
		let loaded = 0;
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIndex = trimmed.indexOf("=");
			if (eqIndex < 1) continue;
			const key = trimmed.slice(0, eqIndex).trim();
			let value = trimmed.slice(eqIndex + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			if (!(key in process.env)) {
				process.env[key] = value;
				loaded++;
			}
		}
		console.info("[video-run] loaded env file", { path: resolved, vars: loaded });
	}
}

async function main(): Promise<void> {
	const currentFile = fileURLToPath(import.meta.url);
	const distDir = dirname(currentFile);
	const repoRoot = resolve(distDir, "..", "..", "..");
	const packageRoot = resolve(distDir, "..");

	loadEnvFile(
		join(repoRoot, ".env.local"),
		join(repoRoot, ".env"),
		join(packageRoot, ".env.local"),
		join(packageRoot, ".env"),
	);

	const preloadPath = join(distDir, "preload.cjs");
	const indexFile = join(distDir, "renderer", "index.html");
	console.info("[video-run] starting Electron app", { distDir, preloadPath, indexFile });

	await createVideoElectronApp({
		preloadPath,
		indexFile,
	});
	console.info("[video-run] Electron app initialized");
}

void main();
