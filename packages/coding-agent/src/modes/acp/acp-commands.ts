/**
 * ACP slash command handling.
 *
 * Provides command building and execution for ACP sessions.
 */

import type * as acp from "@agentclientprotocol/sdk";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentSession } from "../../core/agent-session.js";
import { acpDebug } from "./acp-mode.js";

/**
 * Context needed for command execution.
 */
export type CommandContext = {
	agentSession: AgentSession;
	sendUpdate: (update: acp.SessionUpdate) => void;
};

/**
 * Result of handling a slash command.
 */
export type CommandResult = {
	handled: boolean;
	stopReason?: acp.StopReason;
};

/**
 * Build the list of available slash commands.
 */
export function buildAvailableCommands(agentSession: AgentSession): acp.AvailableCommand[] {
	const commands: acp.AvailableCommand[] = [
		{
			name: "compact",
			description: "Manually compact the session context to free up tokens",
		},
		{
			name: "new",
			description: "Start a new session",
		},
		{
			name: "thinking",
			description: "Set thinking level (off, low, medium, high)",
			input: { hint: "level (off, low, medium, high)" },
		},
	];

	// Add prompt template commands
	for (const template of agentSession.promptTemplates) {
		commands.push({
			name: template.name,
			description: template.description,
			input: { hint: "additional context" },
		});
	}

	// Add skill commands if enabled
	const skillsSettings = agentSession.skillsSettings;
	if (skillsSettings?.enableSkillCommands) {
		for (const skill of agentSession.skills) {
			commands.push({
				name: `skill:${skill.name}`,
				description: skill.description,
				input: { hint: "task description" },
			});
		}
	}

	// Add extension commands
	const extensionCommands = agentSession.extensionRunner?.getRegisteredCommands() ?? [];
	for (const cmd of extensionCommands) {
		commands.push({
			name: cmd.name,
			description: cmd.description ?? "(extension command)",
			input: { hint: "command arguments" },
		});
	}

	return commands;
}

/**
 * Check if text is a slash command and handle it.
 * @returns CommandResult indicating if the command was handled
 */
export async function handleSlashCommand(text: string, ctx: CommandContext): Promise<CommandResult> {
	if (!text.startsWith("/")) {
		return { handled: false };
	}

	const spaceIndex = text.indexOf(" ");
	const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const commandArg = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

	acpDebug(`slash command: /${commandName} arg="${commandArg}"`);

	switch (commandName) {
		case "compact": {
			await handleCompactCommand(ctx);
			return { handled: true, stopReason: "end_turn" };
		}

		case "new": {
			await handleNewCommand(ctx);
			return { handled: true, stopReason: "end_turn" };
		}

		case "thinking": {
			handleThinkingCommand(commandArg, ctx);
			return { handled: true, stopReason: "end_turn" };
		}

		default: {
			// Check if it's a prompt template command
			const template = ctx.agentSession.promptTemplates.find((t) => t.name === commandName);
			if (template) {
				// Return false to let the prompt be processed normally with template expansion
				return { handled: false };
			}

			// Check if it's a skill command
			const skillsSettings = ctx.agentSession.skillsSettings;
			if (skillsSettings?.enableSkillCommands && commandName.startsWith("skill:")) {
				const skillName = commandName.slice(6);
				const skill = ctx.agentSession.skills.find((s) => s.name === skillName);
				if (skill) {
					// Return false to let the prompt be processed normally
					return { handled: false };
				}
			}

			// Check if it's an extension command
			const extensionCommand = ctx.agentSession.extensionRunner?.getCommand(commandName);
			if (extensionCommand) {
				// Return false to let AgentSession handle the extension command
				return { handled: false };
			}

			// Unknown command - send as agent message
			ctx.sendUpdate({
				sessionUpdate: "agent_message_chunk",
				content: {
					type: "text",
					text: `Unknown command: /${commandName}`,
				},
			});
			return { handled: true, stopReason: "end_turn" };
		}
	}
}

/**
 * Handle /compact command.
 */
async function handleCompactCommand(ctx: CommandContext): Promise<void> {
	try {
		ctx.sendUpdate({
			sessionUpdate: "agent_message_chunk",
			content: {
				type: "text",
				text: "Compacting session context...\n",
			},
		});

		const result = await ctx.agentSession.compact();

		ctx.sendUpdate({
			sessionUpdate: "agent_message_chunk",
			content: {
				type: "text",
				text: `Compaction complete. Context had ${result.tokensBefore} tokens before compaction.`,
			},
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		ctx.sendUpdate({
			sessionUpdate: "agent_message_chunk",
			content: {
				type: "text",
				text: `Compaction failed: ${errorMessage}`,
			},
		});
	}
}

/**
 * Handle /new command.
 */
async function handleNewCommand(ctx: CommandContext): Promise<void> {
	const success = await ctx.agentSession.newSession();

	if (success) {
		ctx.sendUpdate({
			sessionUpdate: "agent_message_chunk",
			content: {
				type: "text",
				text: "New session started.",
			},
		});
	} else {
		ctx.sendUpdate({
			sessionUpdate: "agent_message_chunk",
			content: {
				type: "text",
				text: "Failed to start new session.",
			},
		});
	}
}

/**
 * Handle /thinking command.
 */
function handleThinkingCommand(level: string, ctx: CommandContext): void {
	const validLevels: ThinkingLevel[] = ["off", "low", "medium", "high"];
	const normalizedLevel = level.toLowerCase() as ThinkingLevel;

	if (!validLevels.includes(normalizedLevel)) {
		ctx.sendUpdate({
			sessionUpdate: "agent_message_chunk",
			content: {
				type: "text",
				text: `Invalid thinking level: "${level}". Valid levels: ${validLevels.join(", ")}`,
			},
		});
		return;
	}

	ctx.agentSession.setThinkingLevel(normalizedLevel);
	ctx.sendUpdate({
		sessionUpdate: "agent_message_chunk",
		content: {
			type: "text",
			text: `Thinking level set to: ${normalizedLevel}`,
		},
	});
}
