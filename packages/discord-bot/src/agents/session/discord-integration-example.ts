/**
 * Discord Integration Example
 * Shows how to integrate session persistence with Discord slash commands
 *
 * Add these commands to src/main.ts:
 */

import type { ChatInputCommandInteraction } from "discord.js";
import {
	cleanupOldSessions,
	completeSession,
	failSession,
	getActiveSessions,
	getCompletedSessions,
	getFailedSessions,
	getPausedSessions,
	getSessionContext,
	getSessionProgress,
	isSessionResumable,
	pauseSession,
	resumeSession,
} from "./manager.js";
import { getSessionStats } from "./store.js";
import type { SessionSummary } from "./types.js";

/**
 * /session list - List all sessions for the user
 */
export async function handleSessionList(interaction: ChatInputCommandInteraction): Promise<void> {
	const userId = interaction.user.id;
	const filter = interaction.options.getString("filter") || "all";

	let sessions: SessionSummary[];
	switch (filter) {
		case "active":
			sessions = getActiveSessions({ userId });
			break;
		case "paused":
			sessions = getPausedSessions({ userId });
			break;
		case "completed":
			sessions = getCompletedSessions({ userId, limit: 10 });
			break;
		case "failed":
			sessions = getFailedSessions({ userId, limit: 10 });
			break;
		default:
			sessions = getActiveSessions({ userId }).concat(getPausedSessions({ userId })).slice(0, 10);
	}

	if (sessions.length === 0) {
		await interaction.reply({ content: `No ${filter} sessions found.`, ephemeral: true });
		return;
	}

	const lines = sessions.map((s) => {
		const progress = ((s.iterations / s.maxIterations) * 100).toFixed(1);
		return `• \`${s.id.slice(0, 12)}...\` - ${s.mode} - ${s.status} (${progress}%)
    Task: ${s.task.slice(0, 50)}${s.task.length > 50 ? "..." : ""}
    Iterations: ${s.iterations}/${s.maxIterations}`;
	});

	await interaction.reply({
		content: `**Your Sessions (${filter}):**\n\n${lines.join("\n\n")}`,
		ephemeral: true,
	});
}

/**
 * /session info <session_id> - Get detailed session info
 */
export async function handleSessionInfo(interaction: ChatInputCommandInteraction): Promise<void> {
	const sessionId = interaction.options.getString("session_id", true);
	const context = getSessionContext(sessionId);

	if (!context) {
		await interaction.reply({ content: "Session not found.", ephemeral: true });
		return;
	}

	const progress = getSessionProgress(sessionId);
	const recentEvents = (context.recentHistory as any[]).map(
		(e) => `${e.type} - ${new Date(e.timestamp).toLocaleString()}`,
	);

	await interaction.reply({
		content: `**Session Details**

**ID:** \`${sessionId}\`
**Status:** ${context.status}
**Mode:** ${context.mode}
**Task:** ${context.task}
**Progress:** ${progress?.toFixed(1)}% (${context.iterations}/${context.maxIterations} iterations)

**Recent Events:**
${recentEvents.slice(0, 5).join("\n")}`,
		ephemeral: true,
	});
}

/**
 * /session pause <session_id> [reason] - Pause a session
 */
export async function handleSessionPause(interaction: ChatInputCommandInteraction): Promise<void> {
	const sessionId = interaction.options.getString("session_id", true);
	const reason = interaction.options.getString("reason") || "User requested pause";

	try {
		const updated = await pauseSession(sessionId, reason);
		if (!updated) {
			await interaction.reply({ content: "Session not found.", ephemeral: true });
			return;
		}

		await interaction.reply({
			content: `Session paused successfully.\n\nReason: ${reason}\n\nResume later with \`/session resume ${sessionId}\``,
			ephemeral: true,
		});
	} catch (error) {
		await interaction.reply({
			content: `Failed to pause session: ${error instanceof Error ? error.message : String(error)}`,
			ephemeral: true,
		});
	}
}

/**
 * /session resume <session_id> - Resume a paused session
 */
export async function handleSessionResume(interaction: ChatInputCommandInteraction): Promise<void> {
	const sessionId = interaction.options.getString("session_id", true);

	if (!isSessionResumable(sessionId)) {
		await interaction.reply({
			content: "Session not found or cannot be resumed (must be active or paused).",
			ephemeral: true,
		});
		return;
	}

	try {
		await interaction.deferReply();

		const context = getSessionContext(sessionId);
		if (!context) {
			await interaction.editReply("Session not found.");
			return;
		}

		await resumeSession(sessionId);

		// Continue execution
		const { runOpenHandsAgent } = await import("../openhands-agent.js");

		await interaction.editReply(`Resuming session...\n\nTask: ${context.task}\nMode: ${context.mode}`);

		const result = await runOpenHandsAgent({
			task: context.task as string,
			mode: context.mode as string as any,
			sessionId,
			persist: true,
		});

		if (result.success) {
			await completeSession(sessionId, result.output);
			await interaction.editReply(
				`Session completed successfully!\n\nResult:\n\`\`\`\n${result.output.slice(0, 500)}\n\`\`\``,
			);
		} else {
			await failSession(sessionId, result.error || "Failed");
			await interaction.editReply(`Session failed: ${result.error}`);
		}
	} catch (error) {
		await failSession(sessionId, error instanceof Error ? error.message : String(error));
		await interaction.editReply(`Error resuming session: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * /session stats - Show session statistics
 */
export async function handleSessionStats(interaction: ChatInputCommandInteraction): Promise<void> {
	const userId = interaction.user.id;
	const stats = getSessionStats({ userId });

	if (stats.total === 0) {
		await interaction.reply({ content: "No sessions found.", ephemeral: true });
		return;
	}

	const topModes = Object.entries(stats.byMode)
		.sort(([, a], [, b]) => (b as number) - (a as number))
		.slice(0, 5)
		.map(([mode, count]) => `• ${mode}: ${count}`);

	await interaction.reply({
		content: `**Session Statistics**

**Total Sessions:** ${stats.total}
**Success Rate:** ${stats.successRate.toFixed(1)}%
**Average Iterations:** ${stats.averageIterations.toFixed(1)}

**By Status:**
• Active: ${stats.byStatus.active}
• Paused: ${stats.byStatus.paused}
• Completed: ${stats.byStatus.completed}
• Failed: ${stats.byStatus.failed}
• Timeout: ${stats.byStatus.timeout}

**Top Modes:**
${topModes.join("\n")}`,
		ephemeral: true,
	});
}

/**
 * /session cleanup [days] - Clean up old sessions
 */
export async function handleSessionCleanup(interaction: ChatInputCommandInteraction): Promise<void> {
	const days = interaction.options.getInteger("days") || 30;

	const cleaned = cleanupOldSessions(days);

	await interaction.reply({
		content: `Cleaned up ${cleaned} sessions older than ${days} days.`,
		ephemeral: true,
	});
}

/**
 * Example slash command definitions (add to src/main.ts):
 */
export const sessionCommands = [
	{
		name: "session",
		description: "Manage agent sessions",
		options: [
			{
				type: 1, // SUB_COMMAND
				name: "list",
				description: "List your sessions",
				options: [
					{
						type: 3, // STRING
						name: "filter",
						description: "Filter by status",
						choices: [
							{ name: "All", value: "all" },
							{ name: "Active", value: "active" },
							{ name: "Paused", value: "paused" },
							{ name: "Completed", value: "completed" },
							{ name: "Failed", value: "failed" },
						],
					},
				],
			},
			{
				type: 1, // SUB_COMMAND
				name: "info",
				description: "Get session details",
				options: [
					{
						type: 3, // STRING
						name: "session_id",
						description: "Session ID",
						required: true,
					},
				],
			},
			{
				type: 1, // SUB_COMMAND
				name: "pause",
				description: "Pause a session",
				options: [
					{
						type: 3, // STRING
						name: "session_id",
						description: "Session ID",
						required: true,
					},
					{
						type: 3, // STRING
						name: "reason",
						description: "Pause reason",
					},
				],
			},
			{
				type: 1, // SUB_COMMAND
				name: "resume",
				description: "Resume a paused session",
				options: [
					{
						type: 3, // STRING
						name: "session_id",
						description: "Session ID",
						required: true,
					},
				],
			},
			{
				type: 1, // SUB_COMMAND
				name: "stats",
				description: "Show session statistics",
			},
			{
				type: 1, // SUB_COMMAND
				name: "cleanup",
				description: "Clean up old sessions",
				options: [
					{
						type: 4, // INTEGER
						name: "days",
						description: "Delete sessions older than this many days",
					},
				],
			},
		],
	},
];

/**
 * Command handler (add to src/main.ts interactionCreate event):
 */
export async function handleSessionCommand(interaction: ChatInputCommandInteraction): Promise<void> {
	const subcommand = interaction.options.getSubcommand();

	switch (subcommand) {
		case "list":
			await handleSessionList(interaction);
			break;
		case "info":
			await handleSessionInfo(interaction);
			break;
		case "pause":
			await handleSessionPause(interaction);
			break;
		case "resume":
			await handleSessionResume(interaction);
			break;
		case "stats":
			await handleSessionStats(interaction);
			break;
		case "cleanup":
			await handleSessionCleanup(interaction);
			break;
		default:
			await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
	}
}

/**
 * Integration example in main.ts:
 *
 * ```typescript
 * import { sessionCommands, handleSessionCommand } from './agents/session/discord-integration-example.js';
 *
 * // In slash command registration:
 * await rest.put(
 *   Routes.applicationCommands(CLIENT_ID),
 *   { body: [...existingCommands, ...sessionCommands] }
 * );
 *
 * // In interactionCreate event:
 * client.on("interactionCreate", async (interaction) => {
 *   if (!interaction.isChatInputCommand()) return;
 *
 *   if (interaction.commandName === "session") {
 *     await handleSessionCommand(interaction);
 *   }
 * });
 * ```
 */
