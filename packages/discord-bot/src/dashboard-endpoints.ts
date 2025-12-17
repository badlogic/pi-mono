/**
 * Dashboard API Endpoints
 * These endpoints provide data for the dashboard UI
 */

import type { Express, Request, Response } from "express";

export function setupDashboardEndpoints(
	app: Express,
	analytics: any,
	botStats: any,
	model: any,
	currentProvider: string,
	channelStates: Map<string, any>,
	getToolUsageStats: () => any[],
) {
	// Status endpoint - bot uptime, memory, model info, service health
	app.get("/api/status", async (_req: Request, res: Response) => {
		try {
			const uptime = Math.floor((Date.now() - botStats.startTime) / 1000);
			const memUsage = process.memoryUsage();

			// Check OpenRouter API health
			const services: Array<{ name: string; status: string; latency?: number }> = [];

			if (process.env.OPENROUTER_API_KEY) {
				try {
					const start = Date.now();
					const resp = await fetch("https://openrouter.ai/api/v1/models", {
						headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
					});
					services.push({ name: "OpenRouter API", status: resp.ok ? "ok" : "error", latency: Date.now() - start });
				} catch {
					services.push({ name: "OpenRouter API", status: "error" });
				}
			}

			// Add other service checks
			services.push({ name: "Fal.ai (Images)", status: process.env.FAL_KEY ? "ok" : "degraded" });
			services.push({ name: "Suno (Music)", status: process.env.SUNO_API_KEY ? "ok" : "degraded" });
			services.push({ name: "LiveKit (Voice)", status: process.env.LIVEKIT_URL ? "ok" : "degraded" });
			services.push({ name: "ElevenLabs (TTS)", status: process.env.ELEVENLABS_API_KEY ? "ok" : "degraded" });

			res.json({
				status: "online",
				uptime,
				memory: {
					heapUsed: memUsage.heapUsed,
					heapTotal: memUsage.heapTotal,
					rss: memUsage.rss,
				},
				model: model.name,
				provider: currentProvider,
				services,
			});
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: errMsg });
		}
	});

	// Stats endpoint - commands, messages, errors, channels
	app.get("/api/stats", (_req: Request, res: Response) => {
		try {
			const stats = analytics.getStats("all");

			res.json({
				totalCommands: stats.totalCommands,
				totalMessages: botStats.messagesProcessed,
				totalErrors: stats.errors,
				activeChannels: channelStates.size,
				topCommands: stats.topCommands,
				avgResponseTime: stats.avgResponseTime,
			});
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: errMsg });
		}
	});

	// Costs endpoint - total costs, top users, daily breakdown
	app.get("/api/costs", (_req: Request, res: Response) => {
		try {
			const costStats = analytics.getCostStats();
			const topUsers = analytics.getTopCostUsers(10);
			const dailyCosts = analytics.getDailyCosts(7);

			res.json({
				totalCost: costStats.totalEstimatedCostUsd,
				totalTokensInput: costStats.totalTokensInput,
				totalTokensOutput: costStats.totalTokensOutput,
				totalRequests: costStats.totalRequests,
				topUsers: topUsers.map((u: any) => ({
					username: u.username,
					cost: u.estimatedCostUsd,
					requests: u.requests,
				})),
				dailyCosts,
			});
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: errMsg });
		}
	});

	// Tools endpoint - list of all tools with usage stats
	app.get("/api/tools", (_req: Request, res: Response) => {
		try {
			const tools = getToolUsageStats();
			res.json({
				total: tools.length,
				tools: tools.map((t) => ({
					name: t.name,
					count: t.count,
					avgDuration: t.count > 0 ? Math.round(t.totalDuration / t.count) : 0,
					errors: t.errors,
					lastUsed: new Date(t.lastUsed).toISOString(),
				})),
			});
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: errMsg });
		}
	});

	// Activity endpoint - recent command executions
	app.get("/api/activity", (_req: Request, res: Response) => {
		try {
			const commandStats = analytics.getCommandStats();

			// Get recent activity from command stats
			const activity = commandStats
				.filter((cmd: any) => cmd.lastUsed)
				.sort((a: any, b: any) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
				.slice(0, 20)
				.map((cmd: any) => ({
					timestamp: cmd.lastUsed,
					command: cmd.command,
					username: "User", // We don't track individual command executions
					responseTime: Math.round(cmd.avgResponseTime),
				}));

			res.json({ activity });
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: errMsg });
		}
	});

	// Serve the dashboard HTML at /dashboard
	app.get("/dashboard", (_req: Request, res: Response) => {
		const { dashboardHTML } = require("./dashboard.js");
		res.setHeader("Content-Type", "text/html");
		res.send(dashboardHTML);
	});
}
