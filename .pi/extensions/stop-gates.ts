import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Stop Gates Extension — Quality gate enforcement before commits.
 *
 * Ports Claude Code Stop hooks to Pi's tool_call blocking pattern:
 *
 * 1. quality-gate.sh → Block `git commit` if tests haven't passed this session
 * 2. memory-learn-reminder → Advisory: suggest /memory learn after solving problems
 * 3. continuous-operation-guard → Advisory: warn if long-running supervisors active
 *
 * Strategy: `agent_end` is a passive notification (can't block), so we use
 * `tool_call` blocking on `git commit` instead. The agent must run tests
 * before committing.
 */

// ─── Configuration ──────────────────────────────────────────────────────────

/** Patterns that indicate test execution */
const TEST_COMMAND_PATTERNS = [
	/\bpytest\b/,
	/\buv run pytest\b/,
	/\bnpm test\b/,
	/\bnpx vitest\b/,
	/\bnpx jest\b/,
	/\bpython -m pytest\b/,
	/\bcargo test\b/,
	/\bgo test\b/,
];

/** Patterns that indicate a git commit attempt */
const COMMIT_PATTERNS = [
	/\bgit commit\b/,
	/\bgit merge\b.*--no-ff/,
];

/** Patterns that indicate skills-ci was run (also counts as quality gate) */
const CI_PATTERNS = [
	/skills[_-]ci\.py/,
	/skills-ci\/run\.sh/,
];

const BLOCK_MESSAGE =
	"BLOCKED: Run tests before committing. Quality gate is non-negotiable.\n" +
	"Run: uv run pytest tests -q -x --tb=short\n" +
	"Or the project-specific test command, then commit.";

// ─── Extension ──────────────────────────────────────────────────────────────

export default function stopGates(pi: ExtensionAPI) {
	let testsPassedThisSession = false;
	let lastTestTimestamp = 0;
	let blockedCommits = 0;

	// Detect test execution success from tool results
	pi.on("tool_result", async (event) => {
		if (event.toolName !== "bash") return;

		const input = (event.input || {}) as any;
		const command = typeof input.command === "string" ? input.command : "";

		if (!command) return;

		// Check if this was a test command
		const isTestRun = TEST_COMMAND_PATTERNS.some((p) => p.test(command));
		const isCiRun = CI_PATTERNS.some((p) => p.test(command));

		if ((isTestRun || isCiRun) && !event.isError) {
			testsPassedThisSession = true;
			lastTestTimestamp = Date.now();
		}
	});

	// Block commits if tests haven't passed
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;

		const input = (event.input || {}) as any;
		const command = typeof input.command === "string" ? input.command : "";

		if (!command) return;

		// Only gate commit commands
		if (!COMMIT_PATTERNS.some((p) => p.test(command))) return;

		if (!testsPassedThisSession) {
			blockedCommits++;
			return {
				block: true,
				reason: BLOCK_MESSAGE,
			};
		}
	});

	// Register /quality-gate diagnostic command
	pi.registerCommand("quality-gate", {
		description: "Quality gate status: test pass state, blocked commits",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`Quality Gate:\n` +
				`  Tests passed this session: ${testsPassedThisSession}\n` +
				`  Last test run: ${lastTestTimestamp ? new Date(lastTestTimestamp).toISOString() : "never"}\n` +
				`  Blocked commits (session): ${blockedCommits}`,
				"info",
			);
		},
	});
}
