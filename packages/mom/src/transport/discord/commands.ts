import {
	ActionRowBuilder,
	type ChatInputCommandInteraction,
	type Client,
	type ModalActionRowComponentBuilder,
	ModalBuilder,
	type ModalSubmitInteraction,
	REST,
	Routes,
	SlashCommandBuilder,
	TextInputBuilder,
	TextInputStyle,
} from "discord.js";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname, join } from "path";
import * as log from "../../log.js";

export interface CommandHandler {
	onMomCommand(interaction: ChatInputCommandInteraction): Promise<void>;
	onStopCommand(interaction: ChatInputCommandInteraction): Promise<void>;
	onMemoryCommand(interaction: ChatInputCommandInteraction): Promise<void>;
	onMemoryEditSubmit(interaction: ModalSubmitInteraction): Promise<void>;
}

const momCommand = new SlashCommandBuilder()
	.setName("mom")
	.setDescription("Send a message to mom")
	.addStringOption((option) => option.setName("message").setDescription("Your message to mom").setRequired(true));

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
			.addChoices({ name: "view", value: "view" }, { name: "edit", value: "edit" }),
	)
	.addStringOption((option) =>
		option
			.setName("scope")
			.setDescription("Which memory to access")
			.setRequired(false)
			.addChoices({ name: "channel", value: "channel" }, { name: "global", value: "global" }),
	);

export const commands = [momCommand, momStopCommand, momMemoryCommand];

export async function registerCommands(clientId: string, token: string, guildId?: string): Promise<void> {
	const rest = new REST().setToken(token);

	try {
		log.logInfo("Registering Discord slash commands...");

		const commandData = commands.map((cmd) => cmd.toJSON());

		if (guildId) {
			await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commandData });
			log.logInfo(`Registered ${commands.length} Discord commands to guild ${guildId}`);
		} else {
			await rest.put(Routes.applicationCommands(clientId), { body: commandData });
			log.logInfo(`Registered ${commands.length} Discord commands globally`);
		}
	} catch (error) {
		log.logWarning("Failed to register Discord commands", String(error));
		throw error;
	}
}

export function setupCommandHandlers(client: Client, handler: CommandHandler): void {
	client.on("interactionCreate", async (interaction) => {
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

		if (interaction.isModalSubmit()) {
			if (interaction.customId.startsWith("memory-edit-")) {
				await handler.onMemoryEditSubmit(interaction);
			}
		}
	});
}

export function getMemoryPath(
	workingDir: string,
	channelId: string,
	guildId: string | undefined,
	scope: "channel" | "global",
): string {
	if (scope === "global") {
		return join(workingDir, "MEMORY.md");
	}

	if (guildId) {
		return join(workingDir, "discord", guildId, channelId, "MEMORY.md");
	}
	return join(workingDir, "discord", "dm", channelId, "MEMORY.md");
}

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

export async function writeMemory(memoryPath: string, content: string): Promise<void> {
	const dir = dirname(memoryPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	await writeFile(memoryPath, content, "utf-8");
}

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
