import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Test Lab Guard Extension.
 *
 * Enforces the information barrier between coding agents and hidden tests.
 * Blocks all reads of:
 *   - best-practices-{name}/tests/ (generated hidden test cases)
 *   - test-lab/generators/ (test generation source)
 *   - test-lab/test_lab.py (orchestrator source)
 *
 * This prevents coding agents from seeing the tests that evaluate their work,
 * eliminating the "training on your eval set" failure mode.
 *
 * Reference: ImpossibleBench (arXiv:2510.20270) — hiding tests reduces
 * cheating from 76% to near-zero.
 */

const BLOCKED_PATTERNS = [
	/best-practices-[^/]+\/tests\//,
	/test-lab\/generators\//,
	/test-lab\/test_lab\.py/,
];

const BLOCK_REASON =
	"Access denied: blind evaluation tests are not readable by coding agents";

function containsBlockedPath(value: unknown): boolean {
	if (typeof value !== "string") return false;
	return BLOCKED_PATTERNS.some((pattern) => pattern.test(value));
}

export default function testLabGuard(pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		const input = (event.input || {}) as any;

		// Check all string fields that could contain file paths or commands
		const pathFields = [
			input.file_path,
			input.path,
			input.command,
			input.pattern,
			input.directory,
		].filter(Boolean);

		for (const field of pathFields) {
			if (containsBlockedPath(field)) {
				return {
					block: true,
					reason: BLOCK_REASON,
				};
			}
		}

		// For Bash commands, also check if the command string references blocked paths
		if (typeof input.command === "string") {
			for (const pattern of BLOCKED_PATTERNS) {
				if (pattern.test(input.command)) {
					return {
						block: true,
						reason: BLOCK_REASON,
					};
				}
			}
		}
	});
}
