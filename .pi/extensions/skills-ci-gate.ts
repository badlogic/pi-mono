import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Skills CI Gate Extension — Automatic pre/post /skills-ci enforcement.
 *
 * Problem: Agents modify files under .pi/skills/ without running /skills-ci,
 * introducing regressions that cost ~1hr/day to discover and fix manually.
 *
 * Solution: Track every file write/edit that touches .pi/skills/. When the
 * agent finishes a turn where skill files were modified, BLOCK the next
 * code-exploration tool call until /skills-ci scan has been run.
 *
 * Enforcement flow:
 *   1. tool_result: Detect Edit/Write targeting .pi/skills/**
 *   2. turn_end: If skill files were modified, set pendingCiScan flag
 *   3. tool_call: On next turn, BLOCK code exploration until skills-ci runs
 *   4. tool_result: Detect skills-ci execution → clear the gate
 *
 * Coordinates with skill-first-gate.ts — this gate fires AFTER memory-first.
 * The agent flow becomes:
 *   /memory recall → skill selection → code changes → /skills-ci scan
 */

// ─── Configuration ──────────────────────────────────────────────────────────

/** File path patterns that indicate skill modifications */
const SKILL_FILE_PATTERNS = [
	/\.pi\/skills\/[^/]+\/.*\.(py|ts|js|sh|toml|json|yaml|yml|md)$/,
	/\.pi\/skills\/[^/]+\/run\.sh$/,
	/\.pi\/skills\/[^/]+\/sanity\.sh$/,
	/\.pi\/skills\/[^/]+\/SKILL\.md$/,
	/\.pi\/skills\/[^/]+\/pyproject\.toml$/,
];

/** Patterns that indicate skills-ci was executed */
const SKILLS_CI_PATTERNS = [
	/skills[_-]ci\.py/,
	/skills-ci\/run\.sh/,
	/\/skills-ci\b/,
];

/** Tools that modify files */
const WRITE_TOOLS = new Set(["edit", "write", "bash"]);

/** Bash commands that modify skill files */
const BASH_WRITE_PATTERNS = [
	/\b(mv|cp|rm|sed|awk)\b.*\.pi\/skills\//,
	/\bcat\b.*>.*\.pi\/skills\//,
	/\becho\b.*>.*\.pi\/skills\//,
	/\btee\b.*\.pi\/skills\//,
];

/** Tools that are gated (can't proceed without CI scan) */
const GATED_TOOLS = new Set(["edit", "write", "bash", "grep", "glob", "find", "read"]);

/** Always exempt from gating */
const EXEMPT_PATTERNS = [
	/skills-ci/,          // Running skills-ci itself
	/skills_ci/,          // Python import form
	/SKILL\.md/,          // Reading skill metadata
	/CLAUDE\.md/,
	/MEMORY\.md/,
	/README\.md/,
	/\bgit\s+(status|log|diff|add|commit|push)/,
	/\.pi\/skills\/memory\//,  // Memory queries exempt
	/\.pi\/extensions\//,      // Extension changes don't need skills-ci
];

const BLOCK_MESSAGE =
	"BLOCKED: You modified skill files but haven't run /skills-ci scan. " +
	"This is non-negotiable per CLAUDE.md. Run:\n" +
	"  cd .pi/skills/skills-ci && uv run python skills_ci.py --mode scan\n" +
	"Then continue your work.";

// ─── Extension ──────────────────────────────────────────────────────────────

export default function skillsCiGate(pi: ExtensionAPI) {
	let modifiedSkillFiles: string[] = [];
	let pendingCiScan = false;
	let ciRunThisTurn = false;
	let blockedCount = 0;
	let lastCiRunTimestamp = 0;

	// Reset per-turn tracking
	pi.on("turn_start", async () => {
		modifiedSkillFiles = [];
		ciRunThisTurn = false;
	});

	// Detect skill file modifications from tool results
	pi.on("tool_result", async (event) => {
		const input = (event.input || {}) as any;
		const toolName = event.toolName;

		if (!WRITE_TOOLS.has(toolName)) return;

		let targetPath = "";

		if (toolName === "edit" || toolName === "write") {
			targetPath = input.file_path || "";
		} else if (toolName === "bash" && typeof input.command === "string") {
			const cmd = input.command;

			// Check if this bash command ran skills-ci
			if (SKILLS_CI_PATTERNS.some((p) => p.test(cmd))) {
				// Skills CI was run — check if it succeeded (isError=true for non-zero exit)
				if (!event.isError) {
					ciRunThisTurn = true;
					pendingCiScan = false;
					lastCiRunTimestamp = Date.now();
				}
				return;
			}

			// Check if bash command modified skill files
			if (BASH_WRITE_PATTERNS.some((p) => p.test(cmd))) {
				// Extract approximate path from command
				const pathMatch = cmd.match(/\.pi\/skills\/[^\s'"]+/);
				if (pathMatch) {
					targetPath = pathMatch[0];
				}
			}
		}

		if (!targetPath) return;

		// Check if this path is a skill file
		if (SKILL_FILE_PATTERNS.some((p) => p.test(targetPath))) {
			modifiedSkillFiles.push(targetPath);
			pendingCiScan = true;
		}
	});

	// Gate: block further work if skills-ci hasn't been run after modifications
	pi.on("tool_call", async (event) => {
		if (!pendingCiScan) return;
		if (!GATED_TOOLS.has(event.toolName)) return;

		const input = (event.input || {}) as any;

		// Build text to check for exemptions
		let checkText = "";
		if (event.toolName === "bash" && typeof input.command === "string") {
			checkText = input.command;
		} else {
			checkText = [input.file_path, input.path, input.pattern, input.command]
				.filter(Boolean)
				.join(" ");
		}

		if (!checkText) return;

		// Always exempt certain operations
		if (EXEMPT_PATTERNS.some((p) => p.test(checkText))) {
			// Special case: detect skills-ci being invoked
			if (SKILLS_CI_PATTERNS.some((p) => p.test(checkText))) {
				// Will be confirmed in tool_result when it succeeds
				return;
			}
			return;
		}

		// Block if CI scan is still pending
		blockedCount++;
		return {
			block: true,
			reason: BLOCK_MESSAGE,
		};
	});

	// Register /ci-gate diagnostic command
	pi.registerCommand("ci-gate", {
		description: "Skills CI gate status: pending scan, modified files, blocks",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`Skills CI Gate:\n` +
				`  Pending CI scan: ${pendingCiScan}\n` +
				`  CI run this turn: ${ciRunThisTurn}\n` +
				`  Modified skill files (this turn): ${modifiedSkillFiles.length}\n` +
				`    ${modifiedSkillFiles.join("\n    ") || "(none)"}\n` +
				`  Total blocks (session): ${blockedCount}\n` +
				`  Last CI run: ${lastCiRunTimestamp ? new Date(lastCiRunTimestamp).toISOString() : "never"}`,
				"info",
			);
		},
	});
}
