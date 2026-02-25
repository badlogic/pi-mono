import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * TTSR — Time-Triggered Stream Rules (inspired by oh-my-pi).
 *
 * Declarative rules that inject guidance when conditions match during tool
 * execution. Rules are loaded from .pi/ttsr-rules/*.json at session start.
 *
 * Rules can match against:
 * - tool_result content (output of tools) via `matchOn: "result"` (default)
 * - tool_call input (command/args) via `matchOn: "command"`
 *
 * Uses Pi's `sendMessage` with `deliverAs: "steer"` for zero-interruption
 * guidance injection.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";

// ============================================================================
// Rule Types
// ============================================================================

interface TtsrRule {
	name: string;
	conditions: string[];
	toolScope?: string;
	globs?: string[];
	message: string;
	repeatMode?: "once" | "repeat";
	repeatGap?: number;
	description?: string;
	/** What to match against: "result" (tool output) or "command" (tool input). Default: "result" */
	matchOn?: "result" | "command";
}

interface CompiledRule {
	rule: TtsrRule;
	compiledConditions: RegExp[];
}

interface InjectionRecord {
	lastInjectedAtTurn: number;
	count: number;
}

const RULES_DIR = ".pi/ttsr-rules";

export default function ttsr(pi: ExtensionAPI) {
	const compiledRules = new Map<string, CompiledRule>();
	const injectionRecords = new Map<string, InjectionRecord>();
	let currentTurn = 0;

	function loadRulesFromDisk(cwd: string) {
		const rulesPath = resolve(cwd, RULES_DIR);
		if (!existsSync(rulesPath)) return;

		let files: string[];
		try {
			files = readdirSync(rulesPath).filter((f) => f.endsWith(".json"));
		} catch {
			return;
		}

		for (const file of files) {
			try {
				const content = readFileSync(join(rulesPath, file), "utf-8");
				const parsed = JSON.parse(content);
				const ruleList: TtsrRule[] = Array.isArray(parsed) ? parsed : [parsed];

				for (const rule of ruleList) {
					if (!rule.name || !rule.conditions || !rule.message) continue;

					// Pre-compile regexes — invalid patterns are caught and logged
					const compiled: RegExp[] = [];
					let valid = true;
					for (const pattern of rule.conditions) {
						try {
							compiled.push(new RegExp(pattern));
						} catch (err) {
							pi.sendMessage(
								{
									customType: "ttsr-warning",
									content: `[TTSR] Invalid regex in rule "${rule.name}": ${pattern} — ${err instanceof Error ? err.message : String(err)}`,
									display: false,
								},
								{ triggerTurn: false },
							);
							valid = false;
						}
					}

					if (valid) {
						compiledRules.set(rule.name, { rule, compiledConditions: compiled });
					}
				}
			} catch {
				// Skip malformed JSON files
			}
		}
	}

	function canFire(rule: TtsrRule): boolean {
		const record = injectionRecords.get(rule.name);
		if (!record) return true;
		if ((rule.repeatMode ?? "once") === "once") return false;
		return currentTurn - record.lastInjectedAtTurn >= (rule.repeatGap ?? 5);
	}

	function recordFiring(rule: TtsrRule) {
		const existing = injectionRecords.get(rule.name);
		injectionRecords.set(rule.name, {
			lastInjectedAtTurn: currentTurn,
			count: (existing?.count ?? 0) + 1,
		});
	}

	function getToolPaths(input: Record<string, unknown>): string[] {
		const paths: string[] = [];
		for (const key of ["file_path", "path", "directory"]) {
			if (typeof input[key] === "string") paths.push(input[key] as string);
		}
		return paths;
	}

	// Simple glob match — handles *, **, and ? only. Escapes regex metacharacters.
	function matchesGlob(filePath: string, pattern: string): boolean {
		const escaped = pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex metacharacters (NOT * and ?)
			.replace(/\*\*/g, "__GLOBSTAR__")
			.replace(/\*/g, "[^/]*")
			.replace(/\?/g, "[^/]")
			.replace(/__GLOBSTAR__/g, ".*");
		try {
			return new RegExp(`^${escaped}$`).test(filePath);
		} catch {
			return false;
		}
	}

	function checkRules(text: string, toolName: string, toolPaths: string[], matchOn: "result" | "command") {
		for (const [, { rule, compiledConditions }] of compiledRules) {
			if ((rule.matchOn ?? "result") !== matchOn) continue;
			if (!canFire(rule)) continue;
			if (rule.toolScope && toolName !== rule.toolScope) continue;

			if (rule.globs && rule.globs.length > 0) {
				if (!toolPaths.some((p) => rule.globs!.some((g) => matchesGlob(p, g)))) continue;
			}

			if (!compiledConditions.every((re) => re.test(text))) continue;

			recordFiring(rule);
			pi.sendMessage(
				{
					customType: "ttsr-injection",
					content: `[TTSR: ${rule.name}] ${rule.message}`,
					display: false,
					details: { rule: rule.name, turn: currentTurn },
				},
				{ triggerTurn: false, deliverAs: "steer" },
			);
		}
	}

	// =========================================================================
	// Hooks
	// =========================================================================

	pi.on("session_start", async (_event, ctx) => {
		loadRulesFromDisk(ctx.cwd);
	});

	pi.on("turn_start", async (event) => {
		currentTurn = event.turnIndex;
	});

	// Match "command" rules against tool_call input
	pi.on("tool_call", async (event) => {
		if (compiledRules.size === 0) return;

		const input = event.input as Record<string, unknown>;
		// For bash: check the command string. For others: check stringified input.
		const text =
			event.toolName === "bash" && typeof input.command === "string"
				? input.command
				: JSON.stringify(input);

		checkRules(text, event.toolName, getToolPaths(input), "command");
	});

	// Match "result" rules against tool_result output
	pi.on("tool_result", async (event) => {
		if (compiledRules.size === 0) return;

		const textContent = event.content
			.filter((c): c is { type: "text"; text: string } => "text" in c)
			.map((c) => c.text)
			.join("\n");

		if (!textContent) return;

		checkRules(textContent, event.toolName, getToolPaths(event.input), "result");
	});

	pi.registerCommand("ttsr", {
		description: "Manage TTSR rules: list, reset, reload",
		handler: async (args, ctx) => {
			const subcommand = args.trim().split(/\s+/)[0] || "list";

			if (subcommand === "list") {
				if (compiledRules.size === 0) {
					ctx.ui.notify("No TTSR rules loaded. Create .pi/ttsr-rules/*.json to define rules.", "info");
					return;
				}
				const lines = Array.from(compiledRules.values()).map(({ rule }) => {
					const record = injectionRecords.get(rule.name);
					const status = record ? `fired ${record.count}x` : "unfired";
					const target = rule.matchOn ?? "result";
					return `  ${rule.name} [${rule.repeatMode ?? "once"}, ${target}] (${status}) — ${rule.description ?? rule.conditions.join(", ")}`;
				});
				ctx.ui.notify(`TTSR Rules:\n${lines.join("\n")}`, "info");
			} else if (subcommand === "reset") {
				injectionRecords.clear();
				ctx.ui.notify("TTSR injection records cleared.", "info");
			} else if (subcommand === "reload") {
				compiledRules.clear();
				loadRulesFromDisk(ctx.cwd);
				ctx.ui.notify(`Reloaded ${compiledRules.size} TTSR rules from ${RULES_DIR}/`, "info");
			} else {
				ctx.ui.notify("Usage: /ttsr [list|reset|reload]", "info");
			}
		},
	});
}
