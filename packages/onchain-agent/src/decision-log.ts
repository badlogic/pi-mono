import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { ActionResult, GameAction } from "./types.js";

/**
 * A recorded decision made by the agent during a game tick.
 */
export interface Decision {
	tick: number;
	timestamp: number;
	reasoning: string;
	actionTaken?: GameAction;
	result?: ActionResult;
	skillsActivated?: string[];
	taskUpdates?: string[];
	soulUpdated?: boolean;
}

/**
 * Interface for recording and retrieving agent decisions.
 */
export interface DecisionRecorder {
	record(decision: Decision): Promise<void>;
	getDecisions(options?: { since?: number; limit?: number }): Promise<Decision[]>;
}

/**
 * Creates a decision recorder that persists decisions as markdown files
 * with YAML frontmatter in the specified directory.
 *
 * Each decision is stored as `{tick}-{timestamp}.md` with:
 * - YAML frontmatter containing tick, timestamp, actionType, success, soulUpdated
 * - Markdown body with reasoning, action details, and result
 */
export function createDecisionRecorder(logDir: string): DecisionRecorder {
	return {
		async record(decision) {
			mkdirSync(logDir, { recursive: true });
			const filename = `${decision.tick}-${decision.timestamp}.md`;
			const frontmatter = {
				tick: decision.tick,
				timestamp: decision.timestamp,
				actionType: decision.actionTaken?.type ?? "none",
				success: decision.result?.success ?? null,
				soulUpdated: decision.soulUpdated ?? false,
			};
			let content = `---\n${yamlStringify(frontmatter)}---\n\n`;
			content += `# Decision at Tick ${decision.tick}\n\n`;
			content += `## Reasoning\n\n${decision.reasoning}\n\n`;
			if (decision.actionTaken) {
				content += `## Action\n\n- Type: ${decision.actionTaken.type}\n- Params: ${JSON.stringify(decision.actionTaken.params)}\n\n`;
			}
			if (decision.result) {
				content += `## Result\n\n- Success: ${decision.result.success}\n`;
				if (decision.result.txHash) content += `- TxHash: ${decision.result.txHash}\n`;
				if (decision.result.error) content += `- Error: ${decision.result.error}\n`;
			}
			writeFileSync(join(logDir, filename), content);
		},

		async getDecisions(options) {
			if (!existsSync(logDir)) return [];
			const files = readdirSync(logDir)
				.filter((f) => f.endsWith(".md"))
				.sort((a, b) => {
					const tickA = parseInt(a.split("-")[0], 10);
					const tickB = parseInt(b.split("-")[0], 10);
					if (tickA !== tickB) return tickA - tickB;
					// Same tick: sort by timestamp (second segment)
					const tsA = parseInt(a.split("-")[1], 10);
					const tsB = parseInt(b.split("-")[1], 10);
					return tsA - tsB;
				});
			let decisions: Decision[] = files.map((f) => {
				const raw = readFileSync(join(logDir, f), "utf-8");
				const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
				const fm = fmMatch ? yamlParse(fmMatch[1]) : {};
				// Extract reasoning from body
				const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
				const reasoningMatch = body.match(/## Reasoning\n\n([\s\S]*?)(?=\n## |$)/);
				return {
					tick: fm.tick ?? 0,
					timestamp: fm.timestamp ?? 0,
					reasoning: reasoningMatch?.[1]?.trim() ?? "",
				};
			});
			if (options?.since !== undefined) {
				decisions = decisions.filter((d) => d.tick >= options.since!);
			}
			if (options?.limit !== undefined) {
				decisions = decisions.slice(-options.limit);
			}
			return decisions;
		},
	};
}
