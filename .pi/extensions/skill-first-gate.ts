import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Skill-First Gate Extension — BLOCKING enforcement of memory-first contract.
 *
 * Problem: memory-first.ts injects context but the agent can ignore it and
 * start grepping/reading source code directly. Claude Code does this
 * constantly — costing ~1hr/day in wasted reimplementation.
 *
 * Solution: BLOCK tool calls that explore code if memory hasn't been
 * queried this turn. Uses the same { block: true } pattern as test-lab-guard.
 *
 * Enforcement tiers:
 *   1. HARD BLOCK — Bash/Grep/Glob/Read on source code before memory query
 *   2. STEER — Agent is building something a skill already handles
 *
 * Coordinates with memory-first.ts via shared state:
 *   - memory-first.ts sets `pi.state.memoryQueriedThisTurn = true`
 *   - This extension checks that flag before allowing code exploration
 *
 * Exempt operations (never blocked):
 *   - Reading SKILL.md, CLAUDE.md, AGENTS.md (discovery, not coding)
 *   - Git commands (status, log, diff)
 *   - Package metadata (pyproject.toml, package.json)
 *   - Memory/assess/plan skill invocations
 *   - Trivial prompts (<20 chars)
 */

// ─── Configuration ──────────────────────────────────────────────────────────

/** Tools that explore codebases (candidates for blocking) */
const CODE_EXPLORE_TOOLS = new Set(["bash", "grep", "glob", "find", "read"]);

/** Bash commands that are code exploration (not operational) */
const CODE_SCAN_PATTERNS = [
	/\b(find|grep|rg|ag|ack)\b.*\.(py|ts|js|rs|go|java|tsx|jsx)\b/,
	/\bls\s+(-[lRa]+\s+)*.*\/(src|lib|packages|scripts)\b/,
	/\bcat\b.*\.(py|ts|js|rs)\b/,
	/\bhead\b.*\.(py|ts|js|rs)\b/,
	/\btail\b.*\.(py|ts|js|rs)\b/,
	/\bwc\b.*\.(py|ts|js|rs)\b/,
];

/** File paths that indicate code exploration (for Read/Grep/Glob) */
const CODE_PATH_PATTERNS = [
	/\.(py|ts|js|rs|go|java|tsx|jsx)$/,
	/\/(src|lib|packages|scripts)\//,
];

/** Always exempt — these are discovery/metadata, not code exploration */
const EXEMPT_PATTERNS = [
	/SKILL\.md/,
	/CLAUDE\.md/,
	/AGENTS\.md/,
	/MEMORY\.md/,
	/README\.md/,
	/CONTEXT\.md/,
	/pyproject\.toml/,
	/package\.json/,
	/Cargo\.toml/,
	/\.pi\/skills-manifest\.json/,
	/\bgit\s+(status|log|diff|branch|show)\b/,
	/\.pi\/skills\/memory\//,
	/\.pi\/skills\/assess\//,
	/\.pi\/skills\/plan\//,
];

/** Grace period: allow first N tool calls without blocking (agent warm-up) */
const GRACE_CALLS = 0;

const BLOCK_MESSAGE =
	"BLOCKED: Memory-first is non-negotiable. Query /memory recall before exploring code. " +
	"Run: .pi/skills/memory/run.sh recall --q '<your problem>'";

const STEER_MESSAGE_PREFIX =
	"SKILL EXISTS: An existing skill handles this — use it instead of reimplementing. Skill: ";

// ─── State ──────────────────────────────────────────────────────────────────

/** Shared state key set by memory-first.ts */
const MEMORY_QUERIED_KEY = "memoryQueriedThisTurn";

export default function skillFirstGate(pi: ExtensionAPI) {
	let toolCallsThisTurn = 0;
	let currentTurn = 0;
	let blockedCount = 0;

	// Reset per-turn state
	pi.on("turn_start", async (event) => {
		currentTurn = event.turnIndex;
		toolCallsThisTurn = 0;
		// Reset the memory-queried flag (memory-first.ts will set it)
		(pi as any).state = (pi as any).state || {};
		(pi as any).state[MEMORY_QUERIED_KEY] = false;
	});

	pi.on("tool_call", async (event) => {
		toolCallsThisTurn++;

		// Only gate code-exploration tools
		if (!CODE_EXPLORE_TOOLS.has(event.toolName)) return;

		const input = (event.input || {}) as any;

		// Build the text to check (command for bash, paths for others)
		let checkText = "";
		if (event.toolName === "bash" && typeof input.command === "string") {
			checkText = input.command;
		} else {
			checkText = [input.file_path, input.path, input.pattern, input.command, input.directory]
				.filter(Boolean)
				.join(" ");
		}

		if (!checkText) return;

		// Always exempt discovery/metadata reads
		if (EXEMPT_PATTERNS.some((p) => p.test(checkText))) return;

		// Check if this is actually a code exploration call
		let isCodeExplore = false;
		if (event.toolName === "bash") {
			isCodeExplore = CODE_SCAN_PATTERNS.some((p) => p.test(checkText));
		} else {
			isCodeExplore = CODE_PATH_PATTERNS.some((p) => p.test(checkText));
		}

		if (!isCodeExplore) return;

		// Grace period for agent warm-up
		if (toolCallsThisTurn <= GRACE_CALLS) return;

		// CHECK: Has memory been queried this turn?
		const state = (pi as any).state || {};
		const memoryQueried = state[MEMORY_QUERIED_KEY] === true;

		if (!memoryQueried) {
			blockedCount++;
			return {
				block: true,
				reason: BLOCK_MESSAGE,
			};
		}
	});

	// Register /gate command for diagnostics
	pi.registerCommand("gate", {
		description: "Skill-first gate status: blocked count, current state",
		handler: async (_args, ctx) => {
			const state = (pi as any).state || {};
			const memoryQueried = state[MEMORY_QUERIED_KEY] === true;
			ctx.ui.notify(
				`Skill-First Gate:\n` +
				`  Turn: ${currentTurn}\n` +
				`  Memory queried this turn: ${memoryQueried}\n` +
				`  Tool calls this turn: ${toolCallsThisTurn}\n` +
				`  Total blocks (session): ${blockedCount}`,
				"info",
			);
		},
	});
}
