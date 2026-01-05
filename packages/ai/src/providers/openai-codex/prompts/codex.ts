import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GITHUB_API_RELEASES = "https://api.github.com/repos/openai/codex/releases/latest";
const GITHUB_HTML_RELEASES = "https://github.com/openai/codex/releases/latest";

const DEFAULT_AGENT_DIR = join(homedir(), ".pi", "agent");
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FALLBACK_PROMPT_PATH = join(__dirname, "codex-instructions.md");

function getAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || DEFAULT_AGENT_DIR;
}

function getCacheDir(): string {
	return join(getAgentDir(), "cache", "openai-codex");
}

export type ModelFamily = "gpt-5.2-codex" | "codex-max" | "codex" | "gpt-5.2" | "gpt-5.1";

const PROMPT_FILES: Record<ModelFamily, string> = {
	"gpt-5.2-codex": "gpt-5.2-codex_prompt.md",
	"codex-max": "gpt-5.1-codex-max_prompt.md",
	codex: "gpt_5_codex_prompt.md",
	"gpt-5.2": "gpt_5_2_prompt.md",
	"gpt-5.1": "gpt_5_1_prompt.md",
};

const CACHE_FILES: Record<ModelFamily, string> = {
	"gpt-5.2-codex": "gpt-5.2-codex-instructions.md",
	"codex-max": "codex-max-instructions.md",
	codex: "codex-instructions.md",
	"gpt-5.2": "gpt-5.2-instructions.md",
	"gpt-5.1": "gpt-5.1-instructions.md",
};

export type CacheMetadata = {
	etag: string | null;
	tag: string;
	lastChecked: number;
	url: string;
};

export function getModelFamily(normalizedModel: string): ModelFamily {
	if (normalizedModel.includes("gpt-5.2-codex") || normalizedModel.includes("gpt 5.2 codex")) {
		return "gpt-5.2-codex";
	}
	if (normalizedModel.includes("codex-max")) {
		return "codex-max";
	}
	if (normalizedModel.includes("codex") || normalizedModel.startsWith("codex-")) {
		return "codex";
	}
	if (normalizedModel.includes("gpt-5.2")) {
		return "gpt-5.2";
	}
	return "gpt-5.1";
}

async function getLatestReleaseTag(): Promise<string> {
	try {
		const response = await fetch(GITHUB_API_RELEASES);
		if (response.ok) {
			const data = (await response.json()) as { tag_name?: string };
			if (data.tag_name) {
				return data.tag_name;
			}
		}
	} catch {
		// fallback
	}

	const htmlResponse = await fetch(GITHUB_HTML_RELEASES);
	if (!htmlResponse.ok) {
		throw new Error(`Failed to fetch latest release: ${htmlResponse.status}`);
	}

	const finalUrl = htmlResponse.url;
	if (finalUrl) {
		const parts = finalUrl.split("/tag/");
		const last = parts[parts.length - 1];
		if (last && !last.includes("/")) {
			return last;
		}
	}

	const html = await htmlResponse.text();
	const match = html.match(/\/openai\/codex\/releases\/tag\/([^"]+)/);
	if (match?.[1]) {
		return match[1];
	}

	throw new Error("Failed to determine latest release tag from GitHub");
}

export async function getCodexInstructions(normalizedModel = "gpt-5.1-codex"): Promise<string> {
	const modelFamily = getModelFamily(normalizedModel);
	const promptFile = PROMPT_FILES[modelFamily];
	const cacheDir = getCacheDir();
	const cacheFile = join(cacheDir, CACHE_FILES[modelFamily]);
	const cacheMetaFile = join(cacheDir, `${CACHE_FILES[modelFamily].replace(".md", "-meta.json")}`);

	try {
		let cachedETag: string | null = null;
		let cachedTag: string | null = null;
		let cachedTimestamp: number | null = null;

		if (existsSync(cacheMetaFile)) {
			const metadata = JSON.parse(readFileSync(cacheMetaFile, "utf8")) as CacheMetadata;
			cachedETag = metadata.etag;
			cachedTag = metadata.tag;
			cachedTimestamp = metadata.lastChecked;
		}

		const CACHE_TTL_MS = 15 * 60 * 1000;
		if (cachedTimestamp && Date.now() - cachedTimestamp < CACHE_TTL_MS && existsSync(cacheFile)) {
			return readFileSync(cacheFile, "utf8");
		}

		const latestTag = await getLatestReleaseTag();
		const instructionsUrl = `https://raw.githubusercontent.com/openai/codex/${latestTag}/codex-rs/core/${promptFile}`;

		if (cachedTag !== latestTag) {
			cachedETag = null;
		}

		const headers: Record<string, string> = {};
		if (cachedETag) {
			headers["If-None-Match"] = cachedETag;
		}

		const response = await fetch(instructionsUrl, { headers });

		if (response.status === 304) {
			if (existsSync(cacheFile)) {
				return readFileSync(cacheFile, "utf8");
			}
		}

		if (response.ok) {
			const instructions = await response.text();
			const newETag = response.headers.get("etag");

			if (!existsSync(cacheDir)) {
				mkdirSync(cacheDir, { recursive: true });
			}

			writeFileSync(cacheFile, instructions, "utf8");
			writeFileSync(
				cacheMetaFile,
				JSON.stringify({
					etag: newETag,
					tag: latestTag,
					lastChecked: Date.now(),
					url: instructionsUrl,
				} satisfies CacheMetadata),
				"utf8",
			);

			return instructions;
		}

		throw new Error(`HTTP ${response.status}`);
	} catch (error) {
		console.error(
			`[openai-codex] Failed to fetch ${modelFamily} instructions from GitHub:`,
			error instanceof Error ? error.message : String(error),
		);

		if (existsSync(cacheFile)) {
			console.error(`[openai-codex] Using cached ${modelFamily} instructions`);
			return readFileSync(cacheFile, "utf8");
		}

		if (existsSync(FALLBACK_PROMPT_PATH)) {
			console.error(`[openai-codex] Falling back to bundled instructions for ${modelFamily}`);
			return readFileSync(FALLBACK_PROMPT_PATH, "utf8");
		}

		throw new Error(`No cached Codex instructions available for ${modelFamily}`);
	}
}

export const TOOL_REMAP_MESSAGE = `<user_instructions priority="0">
<environment_override priority="0">
YOU ARE IN A DIFFERENT ENVIRONMENT. These instructions override ALL previous tool references.
</environment_override>

<tool_replacements priority="0">
<critical_rule priority="0">
❌ APPLY_PATCH DOES NOT EXIST → ✅ USE "edit" INSTEAD
- NEVER use: apply_patch, applyPatch
- ALWAYS use: edit tool for ALL file modifications
</critical_rule>

<critical_rule priority="0">
❌ UPDATE_PLAN DOES NOT EXIST
- NEVER use: update_plan, updatePlan, read_plan, readPlan, todowrite, todoread
- There is no plan tool in this environment
</critical_rule>
</tool_replacements>

<available_tools priority="0">
File Operations:
  • read  - Read file contents
  • edit  - Modify files with exact find/replace
  • write - Create or overwrite files

Search/Discovery:
  • grep  - Search file contents for patterns (read-only)
  • find  - Find files by glob pattern (read-only)
  • ls    - List directory contents (read-only)

Execution:
  • bash  - Run shell commands
</available_tools>

<verification_checklist priority="0">
Before file modifications:
1. Am I using "edit" NOT "apply_patch"?
2. Am I avoiding plan tools entirely?
3. Am I using only the tools listed above?
</verification_checklist>
</user_instructions>`;
