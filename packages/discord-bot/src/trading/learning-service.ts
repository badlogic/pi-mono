/**
 * Trading Learning Service
 * Connects trading outcomes to expertise system for self-improvement
 */

import { appendFile, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPERTISE_FILE = join(__dirname, "expertise", "trading.md");

// ============================================================================
// Types
// ============================================================================

export interface TradingOutcome {
	timestamp: string;
	symbol: string;
	action: "BUY" | "SELL" | "HOLD";
	entryPrice: number;
	exitPrice?: number;
	pnl?: number;
	success: boolean;
	confidence: number;
	marketCondition: "bull" | "bear" | "sideways" | "volatile";
	agents: string[];
	reason: string;
}

export interface SessionSummary {
	timestamp: string;
	marketCondition: string;
	signalsGenerated: number;
	successfulSignals: number;
	learnings: string[];
	patterns: string[];
	mistakes: string[];
	improvements: string[];
}

// ============================================================================
// Learning Service
// ============================================================================

class TradingLearningService {
	private outcomes: TradingOutcome[] = [];
	private sessionStartTime: number = Date.now();

	/**
	 * Record a trading outcome for learning
	 */
	async recordOutcome(outcome: TradingOutcome): Promise<void> {
		this.outcomes.push(outcome);

		// If we have enough outcomes, trigger a learning update
		if (this.outcomes.length >= 5 || Date.now() - this.sessionStartTime > 3600000) {
			await this.updateExpertise();
		}
	}

	/**
	 * Update expertise file with learnings
	 */
	async updateExpertise(): Promise<void> {
		if (this.outcomes.length === 0) return;

		try {
			const expertise = await readFile(EXPERTISE_FILE, "utf-8");
			const summary = this.generateSessionSummary();
			const sessionEntry = this.formatSessionEntry(summary);

			// Find the Session Insights section and prepend new entry
			const sessionMarker = "## Session Insights";
			const markerIndex = expertise.indexOf(sessionMarker);

			if (markerIndex === -1) {
				// Append to end if section not found
				await appendFile(EXPERTISE_FILE, `\n${sessionEntry}`);
			} else {
				// Insert after marker
				const beforeMarker = expertise.slice(0, markerIndex + sessionMarker.length);
				const afterMarker = expertise.slice(markerIndex + sessionMarker.length);

				// Keep only last 10 sessions
				const sessionsMatch = afterMarker.match(/### Session:/g);
				let trimmedAfter = afterMarker;
				if (sessionsMatch && sessionsMatch.length >= 10) {
					// Remove oldest session
					const lastSessionIndex = afterMarker.lastIndexOf("### Session:");
					trimmedAfter = afterMarker.slice(0, lastSessionIndex);
				}

				const updatedContent = `${beforeMarker}\n${sessionEntry}${trimmedAfter}`;
				await writeFile(EXPERTISE_FILE, updatedContent);
			}

			// Reset for next session
			this.outcomes = [];
			this.sessionStartTime = Date.now();

			console.log(`[TRADING-LEARNING] Updated expertise with ${summary.signalsGenerated} signals`);
		} catch (error) {
			console.error("[TRADING-LEARNING] Failed to update expertise:", error);
		}
	}

	/**
	 * Generate summary from recorded outcomes
	 */
	private generateSessionSummary(): SessionSummary {
		const now = new Date().toISOString();
		const successful = this.outcomes.filter((o) => o.success).length;
		const total = this.outcomes.length;

		// Determine dominant market condition
		const conditions = this.outcomes.map((o) => o.marketCondition);
		const conditionCounts = conditions.reduce(
			(acc, c) => {
				acc[c] = (acc[c] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>,
		);
		const dominantCondition = Object.entries(conditionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";

		// Extract patterns from successful trades
		const successfulOutcomes = this.outcomes.filter((o) => o.success);
		const patterns = successfulOutcomes
			.map((o) => `${o.action} at ${o.confidence.toFixed(2)} confidence worked`)
			.slice(0, 3);

		// Extract mistakes from failed trades
		const failedOutcomes = this.outcomes.filter((o) => !o.success);
		const mistakes = failedOutcomes
			.map((o) => `${o.action} ${o.symbol} failed despite ${o.confidence.toFixed(2)} confidence`)
			.slice(0, 3);

		// Generate learnings
		const learnings: string[] = [];
		const winRate = total > 0 ? (successful / total) * 100 : 0;

		if (winRate > 70) {
			learnings.push(
				`High win rate (${winRate.toFixed(1)}%) - current strategy is effective in ${dominantCondition} market`,
			);
		} else if (winRate < 30) {
			learnings.push(
				`Low win rate (${winRate.toFixed(1)}%) - need to adjust strategy for ${dominantCondition} market`,
			);
		}

		// Confidence calibration
		const avgSuccessConfidence =
			successfulOutcomes.length > 0
				? successfulOutcomes.reduce((sum, o) => sum + o.confidence, 0) / successfulOutcomes.length
				: 0;
		const avgFailConfidence =
			failedOutcomes.length > 0
				? failedOutcomes.reduce((sum, o) => sum + o.confidence, 0) / failedOutcomes.length
				: 0;

		if (avgFailConfidence > avgSuccessConfidence) {
			learnings.push("Confidence scores need recalibration - high confidence signals are underperforming");
		}

		// Generate improvements
		const improvements: string[] = [];
		if (winRate < 50) {
			improvements.push("Consider more conservative entry criteria");
		}
		if (failedOutcomes.some((o) => o.confidence > 0.8)) {
			improvements.push("Review high-confidence signal criteria - some are failing");
		}

		return {
			timestamp: now,
			marketCondition: dominantCondition,
			signalsGenerated: total,
			successfulSignals: successful,
			learnings,
			patterns,
			mistakes,
			improvements,
		};
	}

	/**
	 * Format session entry for markdown
	 */
	private formatSessionEntry(summary: SessionSummary): string {
		return `
### Session: ${summary.timestamp}
**Market Condition:** ${summary.marketCondition}
**Signals Generated:** ${summary.signalsGenerated}
**Successful Signals:** ${summary.successfulSignals}
**Win Rate:** ${summary.signalsGenerated > 0 ? ((summary.successfulSignals / summary.signalsGenerated) * 100).toFixed(1) : 0}%

**Learning:**
${summary.learnings.map((l) => `- ${l}`).join("\n") || "- No significant learnings this session"}

**Patterns Discovered:**
${summary.patterns.map((p) => `- ${p}`).join("\n") || "- No new patterns identified"}

**Mistakes Made:**
${summary.mistakes.map((m) => `- ${m}`).join("\n") || "- No notable mistakes"}

**Improvements for Next Session:**
${summary.improvements.map((i) => `- ${i}`).join("\n") || "- Continue current approach"}

---
`;
	}

	/**
	 * Load expertise for trading context
	 */
	async loadExpertise(): Promise<string> {
		try {
			return await readFile(EXPERTISE_FILE, "utf-8");
		} catch {
			return "No expertise file found - starting fresh";
		}
	}

	/**
	 * Get learning stats
	 */
	getStats(): { outcomes: number; sessionAge: number } {
		return {
			outcomes: this.outcomes.length,
			sessionAge: Date.now() - this.sessionStartTime,
		};
	}
}

// Singleton instance
export const tradingLearning = new TradingLearningService();
