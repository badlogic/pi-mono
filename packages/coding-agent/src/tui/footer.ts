import type { AgentState } from "@mariozechner/pi-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import chalk from "chalk";

/**
 * Footer component that shows pwd, token stats, and context usage
 */
export class FooterComponent {
	private state: AgentState;

	constructor(state: AgentState) {
		this.state = state;
	}

	updateState(state: AgentState): void {
		this.state = state;
	}

	render(width: number): string[] {
		// Calculate cumulative usage from all assistant messages
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const message of this.state.messages) {
			if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				totalInput += assistantMsg.usage.input;
				totalOutput += assistantMsg.usage.output;
				totalCacheRead += assistantMsg.usage.cacheRead;
				totalCacheWrite += assistantMsg.usage.cacheWrite;
				totalCost += assistantMsg.usage.cost.total;
			}
		}

		// Calculate total tokens and % of context window
		const totalTokens = totalInput + totalOutput;
		const contextWindow = this.state.model.contextWindow;
		const contextPercent = contextWindow > 0 ? ((totalTokens / contextWindow) * 100).toFixed(1) : "0.0";

		// Format token counts (similar to web-ui)
		const formatTokens = (count: number): string => {
			if (count < 1000) return count.toString();
			if (count < 10000) return (count / 1000).toFixed(1) + "k";
			return Math.round(count / 1000) + "k";
		};

		// Replace home directory with ~
		let pwd = process.cwd();
		const home = process.env.HOME || process.env.USERPROFILE;
		if (home && pwd.startsWith(home)) {
			pwd = "~" + pwd.slice(home.length);
		}

		// Truncate path if too long to fit width
		const maxPathLength = Math.max(20, width - 10); // Leave some margin
		if (pwd.length > maxPathLength) {
			const start = pwd.slice(0, Math.floor(maxPathLength / 2) - 2);
			const end = pwd.slice(-(Math.floor(maxPathLength / 2) - 1));
			pwd = `${start}...${end}`;
		}

		// Build stats line
		const statsParts = [];
		if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
		if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
		if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
		if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
		if (totalCost) statsParts.push(`$${totalCost.toFixed(3)}`);
		statsParts.push(`${contextPercent}%`);

		const statsLine = statsParts.join(" ");

		// Return two lines: pwd and stats
		return [chalk.gray(pwd), chalk.gray(statsLine)];
	}
}
