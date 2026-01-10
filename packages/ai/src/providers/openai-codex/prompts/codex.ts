import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CODEX_PROMPT_PATH = join(__dirname, "codex-instructions.md");

export type ModelFamily = "gpt-5.2-codex" | "codex-max" | "codex" | "gpt-5.2" | "gpt-5.1";

export type CacheMetadata = {
	etag: string | null;
	tag: string;
	lastChecked: number;
	url: string;
};

export function getModelFamily(model: string): ModelFamily {
	if (model.includes("gpt-5.2-codex") || model.includes("gpt 5.2 codex")) {
		return "gpt-5.2-codex";
	}
	if (model.includes("codex-max")) {
		return "codex-max";
	}
	if (model.includes("codex") || model.startsWith("codex-")) {
		return "codex";
	}
	if (model.includes("gpt-5.2")) {
		return "gpt-5.2";
	}
	return "gpt-5.1";
}

export async function getCodexInstructions(_model = "gpt-5.1-codex"): Promise<string> {
	if (existsSync(CODEX_PROMPT_PATH)) {
		return readFileSync(CODEX_PROMPT_PATH, "utf8");
	}

	throw new Error("No bundled Codex prompt instructions available");
}
