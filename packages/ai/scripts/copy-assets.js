import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");

const source = join(
	packageRoot,
	"src",
	"providers",
	"openai-codex",
	"prompts",
	"codex-instructions.md",
);
const destination = join(
	packageRoot,
	"dist",
	"providers",
	"openai-codex",
	"prompts",
	"codex-instructions.md",
);

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`[pi-ai] Copied ${source} -> ${destination}`);
