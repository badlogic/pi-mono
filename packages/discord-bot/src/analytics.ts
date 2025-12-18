/**
 * Analytics Module - Track usage, performance, and engagement
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export interface CommandMetrics {
	command: string;
	count: number;
	totalResponseTime: number;
	avgResponseTime: number;
	p95ResponseTime: number;
	p99ResponseTime: number;
	errors: number;
	lastUsed: string;
	responseTimes: number[];
}

export interface UserActivity {
	userId: string;
	username: string;
	commandCount: number;
	lastSeen: string;
	firstSeen: string;
}

export interface DailyStats {
	date: string;
	totalCommands: number;
	uniqueUsers: number;
	commands: Record<string, number>;
	users: Record<string, { username: string; count: number; lastSeen: string }>;
	avgResponseTime: number;
	errors: number;
	hourlyDistribution: Record<number, number>;
	modelUsage: Record<string, number>;
}

export interface SummaryStats {
	totalCommandsAllTime: number;
	totalUsersAllTime: number;
	commandStats: Record<string, CommandMetrics>;
	userStats: Record<string, UserActivity>;
	startDate: string;
	lastUpdated: string;
	peakUsageHour: number;
	mostPopularCommand: string;
	avgResponseTime: number;
}

// ============================================================================
// Cost Tracking Types
// ============================================================================

export interface UserCost {
	userId: string;
	username: string;
	totalTokensInput: number;
	totalTokensOutput: number;
	estimatedCostUsd: number;
	requests: number;
	lastUpdated: string;
}

export interface CostStats {
	totalEstimatedCostUsd: number;
	totalTokensInput: number;
	totalTokensOutput: number;
	totalRequests: number;
	userCosts: Record<string, UserCost>;
	dailyCosts: Record<string, number>; // date -> cost
	alertThreshold: number; // USD per user per day
}

export interface CostEvent {
	userId: string;
	username: string;
	tokensInput: number;
	tokensOutput: number;
	model: string;
	timestamp: string;
}

export interface AnalyticsEvent {
	type: "command" | "error" | "response";
	timestamp: string;
	userId: string;
	username: string;
	command?: string;
	responseTime?: number;
	error?: string;
	model?: string;
	channelId?: string;
	channelName?: string;
}

// ============================================================================
// Analytics Class
// ============================================================================

export class Analytics {
	private analyticsDir: string;
	private summaryPath: string;

	constructor(workingDir: string) {
		this.analyticsDir = join(workingDir, "analytics");
		this.summaryPath = join(this.analyticsDir, "summary.json");

		// Ensure analytics directory exists
		if (!existsSync(this.analyticsDir)) {
			mkdirSync(this.analyticsDir, { recursive: true });
		}

		// Initialize summary if it doesn't exist
		if (!existsSync(this.summaryPath)) {
			this.initializeSummary();
		}
	}

	private initializeSummary(): void {
		const summary: SummaryStats = {
			totalCommandsAllTime: 0,
			totalUsersAllTime: 0,
			commandStats: {},
			userStats: {},
			startDate: new Date().toISOString(),
			lastUpdated: new Date().toISOString(),
			peakUsageHour: 0,
			mostPopularCommand: "",
			avgResponseTime: 0,
		};
		writeFileSync(this.summaryPath, JSON.stringify(summary, null, 2));
	}

	private getDailyFilePath(date?: Date): string {
		const d = date || new Date();
		const dateStr = d.toISOString().split("T")[0]; // YYYY-MM-DD
		return join(this.analyticsDir, `daily-${dateStr}.json`);
	}

	private loadDailyStats(date?: Date): DailyStats {
		const filePath = this.getDailyFilePath(date);
		if (existsSync(filePath)) {
			try {
				return JSON.parse(readFileSync(filePath, "utf-8"));
			} catch {
				// If corrupted, return fresh stats
			}
		}

		// Create new daily stats
		const d = date || new Date();
		const dateStr = d.toISOString().split("T")[0];
		return {
			date: dateStr,
			totalCommands: 0,
			uniqueUsers: 0,
			commands: {},
			users: {},
			avgResponseTime: 0,
			errors: 0,
			hourlyDistribution: {},
			modelUsage: {},
		};
	}

	private saveDailyStats(stats: DailyStats, date?: Date): void {
		const filePath = this.getDailyFilePath(date);
		writeFileSync(filePath, JSON.stringify(stats, null, 2));
	}

	private loadSummary(): SummaryStats {
		try {
			return JSON.parse(readFileSync(this.summaryPath, "utf-8"));
		} catch {
			this.initializeSummary();
			return JSON.parse(readFileSync(this.summaryPath, "utf-8"));
		}
	}

	private saveSummary(summary: SummaryStats): void {
		summary.lastUpdated = new Date().toISOString();
		writeFileSync(this.summaryPath, JSON.stringify(summary, null, 2));
	}

	private calculatePercentile(values: number[], percentile: number): number {
		if (values.length === 0) return 0;
		const sorted = values.slice().sort((a, b) => a - b);
		const index = Math.ceil((percentile / 100) * sorted.length) - 1;
		return sorted[Math.max(0, index)];
	}

	// ========================================================================
	// Public Methods
	// ========================================================================

	/**
	 * Track a command execution
	 */
	trackCommand(event: AnalyticsEvent): void {
		const now = new Date();
		const hour = now.getHours();

		// Update daily stats
		const daily = this.loadDailyStats();
		daily.totalCommands++;

		if (event.command) {
			daily.commands[event.command] = (daily.commands[event.command] || 0) + 1;
		}

		if (!daily.users[event.userId]) {
			daily.uniqueUsers++;
			daily.users[event.userId] = {
				username: event.username,
				count: 0,
				lastSeen: event.timestamp,
			};
		}
		daily.users[event.userId].count++;
		daily.users[event.userId].lastSeen = event.timestamp;

		daily.hourlyDistribution[hour] = (daily.hourlyDistribution[hour] || 0) + 1;

		if (event.model) {
			daily.modelUsage[event.model] = (daily.modelUsage[event.model] || 0) + 1;
		}

		if (event.type === "error") {
			daily.errors++;
		}

		if (event.responseTime !== undefined) {
			// Update running average
			const totalResponses = daily.totalCommands - daily.errors;
			daily.avgResponseTime = (daily.avgResponseTime * (totalResponses - 1) + event.responseTime) / totalResponses;
		}

		this.saveDailyStats(daily);

		// Update summary stats
		const summary = this.loadSummary();
		summary.totalCommandsAllTime++;

		if (!summary.userStats[event.userId]) {
			summary.totalUsersAllTime++;
			summary.userStats[event.userId] = {
				userId: event.userId,
				username: event.username,
				commandCount: 0,
				firstSeen: event.timestamp,
				lastSeen: event.timestamp,
			};
		}
		summary.userStats[event.userId].commandCount++;
		summary.userStats[event.userId].lastSeen = event.timestamp;
		summary.userStats[event.userId].username = event.username; // Update username in case it changed

		if (event.command) {
			if (!summary.commandStats[event.command]) {
				summary.commandStats[event.command] = {
					command: event.command,
					count: 0,
					totalResponseTime: 0,
					avgResponseTime: 0,
					p95ResponseTime: 0,
					p99ResponseTime: 0,
					errors: 0,
					lastUsed: event.timestamp,
					responseTimes: [],
				};
			}

			const cmdStats = summary.commandStats[event.command];
			cmdStats.count++;
			cmdStats.lastUsed = event.timestamp;

			if (event.type === "error") {
				cmdStats.errors++;
			}

			if (event.responseTime !== undefined) {
				cmdStats.totalResponseTime += event.responseTime;
				cmdStats.responseTimes.push(event.responseTime);

				// Keep only last 1000 response times to avoid unbounded growth
				if (cmdStats.responseTimes.length > 1000) {
					cmdStats.responseTimes = cmdStats.responseTimes.slice(-1000);
				}

				cmdStats.avgResponseTime = cmdStats.totalResponseTime / (cmdStats.count - cmdStats.errors);
				cmdStats.p95ResponseTime = this.calculatePercentile(cmdStats.responseTimes, 95);
				cmdStats.p99ResponseTime = this.calculatePercentile(cmdStats.responseTimes, 99);
			}
		}

		// Update peak usage hour
		const hourlyTotal = Object.entries(daily.hourlyDistribution).reduce(
			(max, [h, count]) => {
				return count > max.count ? { hour: parseInt(h, 10), count } : max;
			},
			{ hour: 0, count: 0 },
		);
		summary.peakUsageHour = hourlyTotal.hour;

		// Update most popular command
		const topCommand = Object.entries(summary.commandStats).reduce(
			(max, [cmd, stats]) => {
				return stats.count > max.count ? { command: cmd, count: stats.count } : max;
			},
			{ command: "", count: 0 },
		);
		summary.mostPopularCommand = topCommand.command;

		// Update overall average response time
		const allResponseTimes: number[] = [];
		Object.values(summary.commandStats).forEach((cmd) => {
			allResponseTimes.push(...cmd.responseTimes);
		});
		if (allResponseTimes.length > 0) {
			summary.avgResponseTime = allResponseTimes.reduce((sum, t) => sum + t, 0) / allResponseTimes.length;
		}

		this.saveSummary(summary);
	}

	/**
	 * Get analytics for a specific time period
	 */
	getStats(period: "today" | "week" | "all"): {
		totalCommands: number;
		uniqueUsers: number;
		topCommands: Array<{ command: string; count: number }>;
		avgResponseTime: number;
		errors: number;
		activeUsers: Array<{ username: string; count: number }>;
	} {
		const summary = this.loadSummary();

		if (period === "all") {
			const topCommands = Object.values(summary.commandStats)
				.sort((a, b) => b.count - a.count)
				.slice(0, 5)
				.map((c) => ({ command: c.command, count: c.count }));

			const activeUsers = Object.values(summary.userStats)
				.sort((a, b) => b.commandCount - a.commandCount)
				.slice(0, 10)
				.map((u) => ({ username: u.username, count: u.commandCount }));

			return {
				totalCommands: summary.totalCommandsAllTime,
				uniqueUsers: summary.totalUsersAllTime,
				topCommands,
				avgResponseTime: summary.avgResponseTime,
				errors: Object.values(summary.commandStats).reduce((sum, c) => sum + c.errors, 0),
				activeUsers,
			};
		}

		// For today or week, aggregate daily stats
		const now = new Date();
		const days = period === "today" ? 1 : 7;
		const dailyFiles: DailyStats[] = [];

		for (let i = 0; i < days; i++) {
			const date = new Date(now);
			date.setDate(date.getDate() - i);
			const stats = this.loadDailyStats(date);
			dailyFiles.push(stats);
		}

		// Aggregate
		const aggregated = {
			totalCommands: 0,
			uniqueUsers: new Set<string>(),
			commands: {} as Record<string, number>,
			avgResponseTime: 0,
			errors: 0,
			users: {} as Record<string, { username: string; count: number }>,
		};

		let totalResponseTimes = 0;
		let responseCount = 0;

		dailyFiles.forEach((day) => {
			aggregated.totalCommands += day.totalCommands;
			aggregated.errors += day.errors;

			Object.keys(day.users).forEach((userId) => {
				aggregated.uniqueUsers.add(userId);
			});

			Object.entries(day.commands).forEach(([cmd, count]) => {
				aggregated.commands[cmd] = (aggregated.commands[cmd] || 0) + count;
			});

			Object.entries(day.users).forEach(([userId, user]) => {
				if (!aggregated.users[userId]) {
					aggregated.users[userId] = { username: user.username, count: 0 };
				}
				aggregated.users[userId].count += user.count;
			});

			if (day.avgResponseTime > 0) {
				totalResponseTimes += day.avgResponseTime * (day.totalCommands - day.errors);
				responseCount += day.totalCommands - day.errors;
			}
		});

		const topCommands = Object.entries(aggregated.commands)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([command, count]) => ({ command, count }));

		const activeUsers = Object.values(aggregated.users)
			.sort((a, b) => b.count - a.count)
			.slice(0, 10);

		return {
			totalCommands: aggregated.totalCommands,
			uniqueUsers: aggregated.uniqueUsers.size,
			topCommands,
			avgResponseTime: responseCount > 0 ? totalResponseTimes / responseCount : 0,
			errors: aggregated.errors,
			activeUsers,
		};
	}

	/**
	 * Get detailed command statistics
	 */
	getCommandStats(): CommandMetrics[] {
		const summary = this.loadSummary();
		return Object.values(summary.commandStats).sort((a, b) => b.count - a.count);
	}

	/**
	 * Get user activity stats
	 */
	getUserStats(): UserActivity[] {
		const summary = this.loadSummary();
		return Object.values(summary.userStats).sort((a, b) => b.commandCount - a.commandCount);
	}

	/**
	 * Get hourly usage distribution for today
	 */
	getHourlyDistribution(): Record<number, number> {
		const daily = this.loadDailyStats();
		return daily.hourlyDistribution;
	}

	/**
	 * Get model usage statistics
	 */
	getModelUsage(): Record<string, number> {
		const daily = this.loadDailyStats();
		return daily.modelUsage;
	}

	/**
	 * Generate daily summary report
	 */
	generateDailySummary(date?: Date): string {
		const daily = this.loadDailyStats(date);
		const d = date || new Date();
		const dateStr = d.toISOString().split("T")[0];

		let report = `# Daily Analytics Report - ${dateStr}\n\n`;
		report += `**Total Commands:** ${daily.totalCommands}\n`;
		report += `**Unique Users:** ${daily.uniqueUsers}\n`;
		report += `**Average Response Time:** ${daily.avgResponseTime.toFixed(2)}ms\n`;
		report += `**Errors:** ${daily.errors}\n\n`;

		report += `## Top Commands\n`;
		const sortedCommands = Object.entries(daily.commands)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5);
		sortedCommands.forEach(([cmd, count], i) => {
			report += `${i + 1}. \`${cmd}\` - ${count} uses\n`;
		});
		report += `\n`;

		report += `## Hourly Distribution\n`;
		const hours = Object.entries(daily.hourlyDistribution).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
		hours.forEach(([hour, count]) => {
			const bar = "█".repeat(Math.min(count, 20));
			report += `${hour.padStart(2, "0")}:00 ${bar} ${count}\n`;
		});
		report += `\n`;

		report += `## Model Usage\n`;
		Object.entries(daily.modelUsage).forEach(([model, count]) => {
			report += `- ${model}: ${count} requests\n`;
		});

		return report;
	}

	/**
	 * Clean up old daily files (keep last 90 days)
	 */
	cleanup(daysToKeep: number = 90): number {
		const files = readdirSync(this.analyticsDir);
		const now = new Date();
		let deletedCount = 0;

		files.forEach((file) => {
			if (!file.startsWith("daily-") || !file.endsWith(".json")) return;

			const dateMatch = file.match(/daily-(\d{4}-\d{2}-\d{2})\.json/);
			if (!dateMatch) return;

			const fileDate = new Date(dateMatch[1]);
			const daysDiff = (now.getTime() - fileDate.getTime()) / (1000 * 60 * 60 * 24);

			if (daysDiff > daysToKeep) {
				const filePath = join(this.analyticsDir, file);
				try {
					require("fs").unlinkSync(filePath);
					deletedCount++;
				} catch {
					// Ignore errors
				}
			}
		});

		return deletedCount;
	}

	// ========================================================================
	// Cost Tracking Methods
	// ========================================================================

	private getCostFilePath(): string {
		return join(this.analyticsDir, "costs.json");
	}

	private loadCostStats(): CostStats {
		const filePath = this.getCostFilePath();
		if (existsSync(filePath)) {
			try {
				return JSON.parse(readFileSync(filePath, "utf-8"));
			} catch {
				// Return fresh stats if corrupted
			}
		}

		return {
			totalEstimatedCostUsd: 0,
			totalTokensInput: 0,
			totalTokensOutput: 0,
			totalRequests: 0,
			userCosts: {},
			dailyCosts: {},
			alertThreshold: 5.0, // Default $5/user/day threshold
		};
	}

	private saveCostStats(stats: CostStats): void {
		const filePath = this.getCostFilePath();
		writeFileSync(filePath, JSON.stringify(stats, null, 2));
	}

	// Model pricing in USD per 1K tokens (approximate)
	private getModelPricing(model: string): { input: number; output: number } {
		const pricing: Record<string, { input: number; output: number }> = {
			// Claude models
			"anthropic/claude-sonnet-4": { input: 0.003, output: 0.015 },
			"anthropic/claude-3.5-haiku": { input: 0.0008, output: 0.004 },
			"anthropic/claude-3-opus": { input: 0.015, output: 0.075 },
			// OpenAI models
			"openai/gpt-4o": { input: 0.0025, output: 0.01 },
			"openai/gpt-4o-mini": { input: 0.00015, output: 0.0006 },
			// Google models
			"google/gemini-2.5-pro-preview": { input: 0.00125, output: 0.01 },
			"google/gemini-2.5-flash-preview": { input: 0.00015, output: 0.0006 },
			// Open source (via OpenRouter)
			"meta-llama/llama-3.3-70b-instruct": { input: 0.00012, output: 0.0003 },
			"meta-llama/llama-3.1-8b-instruct": { input: 0.00002, output: 0.00003 },
			"deepseek/deepseek-chat-v3.1": { input: 0.00015, output: 0.00075 },
			"mistralai/mistral-small-3.1-24b-instruct": { input: 0.00003, output: 0.00011 },
			"qwen/qwen-2.5-72b-instruct": { input: 0.00007, output: 0.00026 },
		};

		// Try to match model prefix
		for (const [key, prices] of Object.entries(pricing)) {
			if (model.includes(key) || key.includes(model)) {
				return prices;
			}
		}

		// Default pricing (conservative estimate)
		return { input: 0.001, output: 0.002 };
	}

	/**
	 * Track token usage and cost
	 */
	trackCost(event: CostEvent): { estimatedCost: number; alert: boolean; alertMessage: string } {
		const stats = this.loadCostStats();
		const pricing = this.getModelPricing(event.model);

		// Calculate cost
		const inputCost = (event.tokensInput / 1000) * pricing.input;
		const outputCost = (event.tokensOutput / 1000) * pricing.output;
		const totalCost = inputCost + outputCost;

		// Update totals
		stats.totalEstimatedCostUsd += totalCost;
		stats.totalTokensInput += event.tokensInput;
		stats.totalTokensOutput += event.tokensOutput;
		stats.totalRequests++;

		// Update user costs
		if (!stats.userCosts[event.userId]) {
			stats.userCosts[event.userId] = {
				userId: event.userId,
				username: event.username,
				totalTokensInput: 0,
				totalTokensOutput: 0,
				estimatedCostUsd: 0,
				requests: 0,
				lastUpdated: event.timestamp,
			};
		}

		const userCost = stats.userCosts[event.userId];
		userCost.totalTokensInput += event.tokensInput;
		userCost.totalTokensOutput += event.tokensOutput;
		userCost.estimatedCostUsd += totalCost;
		userCost.requests++;
		userCost.lastUpdated = event.timestamp;
		userCost.username = event.username;

		// Update daily costs
		const today = new Date().toISOString().split("T")[0];
		stats.dailyCosts[today] = (stats.dailyCosts[today] || 0) + totalCost;

		// Check for alert threshold
		let alert = false;
		let alertMessage = "";

		// Get user's cost for today
		const userDailyCostKey = `${event.userId}:${today}`;
		const userDailyCosts = this.getUserDailyCost(event.userId, today);
		const newDailyCost = userDailyCosts + totalCost;

		if (newDailyCost > stats.alertThreshold && userDailyCosts <= stats.alertThreshold) {
			alert = true;
			alertMessage = `Cost alert: User ${event.username} exceeded $${stats.alertThreshold.toFixed(2)} today (current: $${newDailyCost.toFixed(2)})`;
		}

		this.saveCostStats(stats);

		return { estimatedCost: totalCost, alert, alertMessage };
	}

	/**
	 * Get user's daily cost (simple calculation based on requests today)
	 */
	private getUserDailyCost(userId: string, date: string): number {
		// This is a simplified calculation - in production you'd track daily user costs separately
		const stats = this.loadCostStats();
		const userCost = stats.userCosts[userId];
		if (!userCost) return 0;

		// Approximate: assume even distribution over last 7 days
		return stats.dailyCosts[date] ? userCost.estimatedCostUsd / 7 : 0;
	}

	/**
	 * Get cost statistics
	 */
	getCostStats(): CostStats {
		return this.loadCostStats();
	}

	/**
	 * Get top users by cost
	 */
	getTopCostUsers(limit: number = 10): UserCost[] {
		const stats = this.loadCostStats();
		return Object.values(stats.userCosts)
			.sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
			.slice(0, limit);
	}

	/**
	 * Set alert threshold
	 */
	setAlertThreshold(usdPerUserPerDay: number): void {
		const stats = this.loadCostStats();
		stats.alertThreshold = usdPerUserPerDay;
		this.saveCostStats(stats);
	}

	/**
	 * Get cost summary for a user
	 */
	getUserCost(userId: string): UserCost | null {
		const stats = this.loadCostStats();
		return stats.userCosts[userId] || null;
	}

	/**
	 * Get daily costs for the last N days
	 */
	getDailyCosts(days: number = 30): Array<{ date: string; cost: number }> {
		const stats = this.loadCostStats();
		const result: Array<{ date: string; cost: number }> = [];

		for (let i = 0; i < days; i++) {
			const date = new Date();
			date.setDate(date.getDate() - i);
			const dateStr = date.toISOString().split("T")[0];
			result.push({
				date: dateStr,
				cost: stats.dailyCosts[dateStr] || 0,
			});
		}

		return result.reverse();
	}
}
