import {
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
	type Client,
	REST,
	Routes,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	ActionRowBuilder,
	type ModalActionRowComponentBuilder,
	type ModalSubmitInteraction,
} from "discord.js";
import { existsSync, readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import * as log from "./log.js";

export interface CommandHandler {
	onMomCommand(interaction: ChatInputCommandInteraction): Promise<void>;
	onStopCommand(interaction: ChatInputCommandInteraction): Promise<void>;
	onMemoryCommand(interaction: ChatInputCommandInteraction): Promise<void>;
	onMemoryEditSubmit(interaction: ModalSubmitInteraction): Promise<void>;
}

// Define slash commands
const momCommand = new SlashCommandBuilder()
	.setName("mom")
	.setDescription("Send a message to mom")
	.addStringOption((option) =>
		option.setName("message").setDescription("Your message to mom").setRequired(true),
	);

const momStopCommand = new SlashCommandBuilder()
	.setName("mom-stop")
	.setDescription("Stop the current mom operation in this channel");

const momMemoryCommand = new SlashCommandBuilder()
	.setName("mom-memory")
	.setDescription("View or edit channel memory")
	.addStringOption((option) =>
		option
			.setName("action")
			.setDescription("What to do with memory")
			.setRequired(true)
			.addChoices(
				{ name: "view", value: "view" },
				{ name: "edit", value: "edit" },
			),
	)
	.addStringOption((option) =>
		option
			.setName("scope")
			.setDescription("Which memory to access")
			.setRequired(false)
			.addChoices(
				{ name: "channel", value: "channel" },
				{ name: "global", value: "global" },
			),
	);

export const commands = [momCommand, momStopCommand, momMemoryCommand];

/**
 * Register slash commands with Discord
 */
export async function registerCommands(clientId: string, token: string, guildId?: string): Promise<void> {
	const rest = new REST().setToken(token);

	try {
		log.logInfo("Registering slash commands...");

		const commandData = commands.map((cmd) => cmd.toJSON());

		if (guildId) {
			// Register to specific guild (instant, good for development)
			await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
				body: commandData,
			});
			log.logInfo(`Registered ${commands.length} commands to guild ${guildId}`);
		} else {
			// Register globally (can take up to an hour to propagate)
			await rest.put(Routes.applicationCommands(clientId), {
				body: commandData,
			});
			log.logInfo(`Registered ${commands.length} commands globally`);
		}
	} catch (error) {
		log.logWarning("Failed to register commands", String(error));
		throw error;
	}
}

/**
 * Set up command interaction handlers
 */
export function setupCommandHandlers(client: Client, handler: CommandHandler, workingDir: string): void {
	client.on("interactionCreate", async (interaction) => {
		// Handle slash commands
		if (interaction.isChatInputCommand()) {
			try {
				switch (interaction.commandName) {
					case "mom":
						await handler.onMomCommand(interaction);
						break;
					case "mom-stop":
						await handler.onStopCommand(interaction);
						break;
					case "mom-memory":
						await handler.onMemoryCommand(interaction);
						break;
				}
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				log.logWarning(`Command error (${interaction.commandName})`, errMsg);

				const reply = { content: `Error: ${errMsg}`, ephemeral: true };
				if (interaction.replied || interaction.deferred) {
					await interaction.followUp(reply);
				} else {
					await interaction.reply(reply);
				}
			}
		}

		// Handle modal submissions (for memory edit)
		if (interaction.isModalSubmit()) {
			if (interaction.customId.startsWith("memory-edit-")) {
				await handler.onMemoryEditSubmit(interaction);
			}
		}
	});
}

/**
 * Get memory file path
 */
export function getMemoryPath(
	workingDir: string,
	channelId: string,
	guildId: string | undefined,
	scope: "channel" | "global",
): string {
	if (scope === "global") {
		return join(workingDir, "MEMORY.md");
	}

	// Channel-specific memory
	if (guildId) {
		return join(workingDir, guildId, channelId, "MEMORY.md");
	}
	return join(workingDir, channelId, "MEMORY.md");
}

/**
 * Read memory content
 */
export function readMemory(memoryPath: string): string {
	if (!existsSync(memoryPath)) {
		return "(no memory yet)";
	}
	try {
		return readFileSync(memoryPath, "utf-8");
	} catch {
		return "(failed to read memory)";
	}
}

/**
 * Write memory content
 */
export async function writeMemory(memoryPath: string, content: string): Promise<void> {
	// Ensure directory exists
	const dir = memoryPath.substring(0, memoryPath.lastIndexOf("/"));
	const { mkdirSync, existsSync } = await import("fs");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	await writeFile(memoryPath, content, "utf-8");
}

/**
 * Create memory edit modal
 */
export function createMemoryEditModal(
	scope: "channel" | "global",
	currentContent: string,
	channelId: string,
): ModalBuilder {
	const modal = new ModalBuilder()
		.setCustomId(`memory-edit-${scope}-${channelId}`)
		.setTitle(`Edit ${scope === "global" ? "Global" : "Channel"} Memory`);

	const contentInput = new TextInputBuilder()
		.setCustomId("memory-content")
		.setLabel("Memory Content")
		.setStyle(TextInputStyle.Paragraph)
		.setValue(currentContent === "(no memory yet)" ? "" : currentContent)
		.setRequired(false)
		.setMaxLength(4000);

	const actionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(contentInput);
	modal.addComponents(actionRow);

	return modal;
}
