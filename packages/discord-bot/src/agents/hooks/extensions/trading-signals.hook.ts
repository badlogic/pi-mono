/**
 * Trading Signals Hook Extension
 *
 * Example extension demonstrating custom trading signal events.
 * Logs trading-related tool calls and captures signal patterns.
 */

import type { AgentHookAPI, ToolCallEvent, ToolResultEvent } from "../types.js";

// Extension metadata
export const name = "Trading Signals";
export const description = "Monitors trading-related tool calls and captures signal patterns";
export const version = "1.0.0";
export const author = "pi-discord-bot";

// Trading-related tool patterns
const TRADING_TOOLS = ["trading_analysis", "get_price", "get_sentiment", "execute_trade", "risk_assessment"];

// Signal accumulator
const signals: Array<{
	timestamp: number;
	tool: string;
	symbol?: string;
	action?: string;
}> = [];

/**
 * Hook factory - the main export
 */
export default function tradingSignalsHook(api: AgentHookAPI): void {
	// Monitor tool calls for trading-related operations
	api.on("tool_call", async (event: ToolCallEvent) => {
		if (isTradingTool(event.toolName)) {
			const signal = {
				timestamp: Date.now(),
				tool: event.toolName,
				symbol: extractSymbol(event.input),
				action: extractAction(event.input),
			};

			signals.push(signal);

			// Keep only last 100 signals
			while (signals.length > 100) {
				signals.shift();
			}

			console.log(`[TradingSignals] Tool called: ${event.toolName}`, signal);
		}

		return undefined; // Don't block
	});

	// Analyze tool results for trading outcomes
	api.on("tool_result", async (event: ToolResultEvent) => {
		if (isTradingTool(event.toolName) && !event.isError) {
			// Parse result for signal info
			try {
				const parsed = JSON.parse(event.result);
				if (parsed.action && parsed.confidence) {
					console.log(
						`[TradingSignals] Signal detected: ${parsed.action} with ${(parsed.confidence * 100).toFixed(1)}% confidence`,
					);
				}
			} catch {
				// Result is not JSON, ignore
			}
		}

		return undefined; // Don't modify result
	});
}

// ============================================================================
// Helper Functions
// ============================================================================

function isTradingTool(toolName: string): boolean {
	return TRADING_TOOLS.some(
		(pattern) => toolName.toLowerCase().includes(pattern) || toolName.toLowerCase().includes("trade"),
	);
}

function extractSymbol(input: Record<string, unknown>): string | undefined {
	return (input.symbol as string) || (input.token as string) || (input.asset as string);
}

function extractAction(input: Record<string, unknown>): string | undefined {
	return (input.action as string) || (input.side as string) || (input.type as string);
}

/**
 * Get accumulated signals (for external access)
 */
export function getSignals(): typeof signals {
	return [...signals];
}

/**
 * Clear signals
 */
export function clearSignals(): void {
	signals.length = 0;
}
