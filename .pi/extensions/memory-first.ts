import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

/**
 * Memory First Extension for Pi (Embry OS Agentic Harness).
 *
 * NON-NEGOTIABLE: All interactions query memory BEFORE scanning codebases.
 * This extension programmatically enforces what .pi/SYSTEM.md declares:
 *   1. recall --q "<problem>" BEFORE any codebase scan
 *   2. If found=true → inject solution context, skip redundant scanning
 *   3. If found=false → proceed normally, learn after solving
 *
 * The extension hooks into `before_agent_start` to prepend memory context
 * and `turn_end` to learn from successful interactions.
 */

const MEMORY_SKILL = ".pi/skills/memory/run.sh";
const MAX_PROMPT_LENGTH = 200; // truncate for recall query
const SKIP_PATTERNS = [/^\//, /^help\b/i, /^clear\b/i]; // skip slash commands

export default function memoryFirst(pi: ExtensionAPI) {
	// Before every agent turn, query memory for relevant context
	pi.on("before_agent_start", async (event, ctx) => {
		const prompt = event.prompt?.trim();
		if (!prompt || prompt.length < 10) return;

		// Skip slash commands and trivial inputs
		if (SKIP_PATTERNS.some((p) => p.test(prompt))) return;

		try {
			const queryText = prompt.substring(0, MAX_PROMPT_LENGTH);
			const result = await pi.exec("bash", [
				"-c",
				`${MEMORY_SKILL} recall --q "${queryText.replace(/"/g, '\\"')}" --json 2>/dev/null || echo '{"found":false}'`,
			]);

			if (!result.stdout) return;

			// Find the last line that's valid JSON
			const lines = result.stdout.trim().split("\n");
			let parsed: any = null;
			for (let i = lines.length - 1; i >= 0; i--) {
				try {
					parsed = JSON.parse(lines[i]);
					break;
				} catch {
					continue;
				}
			}

			if (!parsed) return;

			const found = parsed.found === true || (parsed.results && parsed.results.length > 0);
			if (!found) return;

			// Extract solutions from results
			const items = parsed.items || parsed.results || [];
			if (items.length === 0) return;

			const solutions = items
				.slice(0, 3) // max 3 relevant solutions
				.map((item: any) => {
					const problem = item.problem || item.fact || "";
					const solution = item.solution || item.content || "";
					return `Problem: ${problem}\nSolution: ${solution}`;
				})
				.join("\n\n");

			if (!solutions) return;

			// Inject memory context as a custom message
			return {
				message: {
					customType: "memory-recall",
					content: `[Memory First] Found relevant prior knowledge:\n\n${solutions}\n\nApply these solutions if applicable before scanning the codebase.`,
					display: false, // don't clutter the UI
					details: {
						source: "memory-first-extension",
						results_count: items.length,
					},
				},
			};
		} catch {
			// Memory First should NEVER block. Fail silently.
		}
	});
}
