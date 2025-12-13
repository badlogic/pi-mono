import { Agent, type AgentEvent, ProviderTransport } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { ChannelInfo, DiscordContext, UserInfo } from "./discord.js";
import * as log from "./log.js";
import { createExecutor, type SandboxConfig } from "./sandbox.js";
import type { ChannelStore } from "./store.js";
import { createMomTools, setUploadFunction } from "./tools/index.js";

const model = getModel("anthropic", "claude-sonnet-4-5");

let lastTsMs = 0;
let tsCounter = 0;

function generateTs(): string {
	const now = Date.now();
	if (now === lastTsMs) {
		tsCounter++;
	} else {
		lastTsMs = now;
		tsCounter = 0;
	}
	return `${now}_${tsCounter}`;
}

export interface AgentRunner {
	run(ctx: DiscordContext, channelDir: string, store: ChannelStore): Promise<{ stopReason: string }>;
	abort(): void;
}

function getAnthropicApiKey(): string {
	const key = process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
	if (!key) {
		throw new Error("ANTHROPIC_OAUTH_TOKEN or ANTHROPIC_API_KEY must be set");
	}
	return key;
}

interface LogMessage {
	date?: string;
	ts?: string;
	user?: string;
	userName?: string;
	text?: string;
	attachments?: Array<{ local: string }>;
	isBot?: boolean;
}

function getRecentMessages(channelDir: string, turnCount: number): string {
	const logPath = join(channelDir, "log.jsonl");
	if (!existsSync(logPath)) {
		return "(no message history yet)";
	}

	const content = readFileSync(logPath, "utf-8");
	const lines = content.trim().split("\n").filter(Boolean);

	if (lines.length === 0) {
		return "(no message history yet)";
	}

	const messages: LogMessage[] = [];
	for (const line of lines) {
		try {
			messages.push(JSON.parse(line));
		} catch {}
	}

	// Group into turns
	const turns: LogMessage[][] = [];
	let currentTurn: LogMessage[] = [];
	let lastWasBot: boolean | null = null;

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		const isBot = msg.isBot === true;

		if (lastWasBot === null) {
			currentTurn.unshift(msg);
			lastWasBot = isBot;
		} else if (isBot && lastWasBot) {
			currentTurn.unshift(msg);
		} else {
			turns.unshift(currentTurn);
			currentTurn = [msg];
			lastWasBot = isBot;

			if (turns.length >= turnCount) {
				break;
			}
		}
	}

	if (currentTurn.length > 0 && turns.length < turnCount) {
		turns.unshift(currentTurn);
	}

	const formatted: string[] = [];
	for (const turn of turns) {
		for (const msg of turn) {
			const date = (msg.date || "").substring(0, 19);
			const user = msg.userName || msg.user || "";
			const text = msg.text || "";
			const attachments = (msg.attachments || []).map((a) => a.local).join(",");
			formatted.push(`${date}\t${user}\t${text}\t${attachments}`);
		}
	}

	return formatted.join("\n");
}

function getMemory(channelDir: string): string {
	const parts: string[] = [];

	// Global memory (two levels up for guild channels, one for DMs)
	const globalMemoryPaths = [
		join(channelDir, "..", "..", "MEMORY.md"), // guild/channel structure
		join(channelDir, "..", "MEMORY.md"), // DM structure
	];

	for (const path of globalMemoryPaths) {
		if (existsSync(path)) {
			try {
				const content = readFileSync(path, "utf-8").trim();
				if (content) {
					parts.push("### Global Workspace Memory\n" + content);
					break;
				}
			} catch {}
		}
	}

	// Channel-specific memory
	const channelMemoryPath = join(channelDir, "MEMORY.md");
	if (existsSync(channelMemoryPath)) {
		try {
			const content = readFileSync(channelMemoryPath, "utf-8").trim();
			if (content) {
				parts.push("### Channel-Specific Memory\n" + content);
			}
		} catch {}
	}

	if (parts.length === 0) {
		return "(no working memory yet)";
	}

	return parts.join("\n\n");
}

function buildSystemPrompt(
	workspacePath: string,
	channelId: string,
	guildId: string | undefined,
	memory: string,
	sandboxConfig: SandboxConfig,
	channels: ChannelInfo[],
	users: UserInfo[],
): string {
	const channelPath = guildId ? `${workspacePath}/${guildId}/${channelId}` : `${workspacePath}/${channelId}`;
	const isDocker = sandboxConfig.type === "docker";

	const channelMappings =
		channels.length > 0 ? channels.map((c) => `${c.id}\t#${c.name}`).join("\n") : "(no channels loaded)";

	const userMappings =
		users.length > 0 ? users.map((u) => `${u.id}\t@${u.userName}\t${u.displayName}`).join("\n") : "(no users loaded)";

	const envDescription = isDocker
		? `You are running inside a Docker container (Alpine Linux).
- Bash working directory: / (use cd or absolute paths)
- Install tools with: apk add <package>
- Your changes persist across sessions`
		: `You are running directly on the host machine.
- Bash working directory: ${process.cwd()}
- Be careful with system modifications`;

	const currentDate = new Date().toISOString().split("T")[0];
	const currentDateTime = new Date().toISOString();

	const workspaceLayout = guildId
		? `${workspacePath}/
├── MEMORY.md                    # Global memory (all channels)
├── skills/                      # Global CLI tools you create
└── ${guildId}/                  # This server
    └── ${channelId}/            # This channel
        ├── MEMORY.md            # Channel-specific memory
        ├── log.jsonl            # Full message history
        ├── attachments/         # User-shared files
        ├── scratch/             # Your working directory
        └── skills/              # Channel-specific tools`
		: `${workspacePath}/
├── MEMORY.md                    # Global memory
├── skills/                      # Global CLI tools you create
└── ${channelId}/                # This DM
    ├── MEMORY.md                # DM-specific memory
    ├── log.jsonl                # Full message history
    ├── attachments/             # User-shared files
    ├── scratch/                 # Your working directory
    └── skills/                  # DM-specific tools`;

	return `You are mom, a Discord bot assistant. Be concise. No emojis.

## Context
- Date: ${currentDate} (${currentDateTime})
- You receive the last 50 conversation turns. If you need older context, search log.jsonl.

## Discord Formatting (Markdown)
**Bold**, *Italic*, __Underline__, ~~Strikethrough~~
\`inline code\`, \`\`\`code block\`\`\`
> quote, >>> block quote
# Heading 1, ## Heading 2, ### Heading 3
[link text](url)

## Discord Mentions
- User: <@USER_ID>
- Channel: <#CHANNEL_ID>
- Role: <@&ROLE_ID>

## Discord IDs
Channels: ${channelMappings}

Users: ${userMappings}

When mentioning users, use <@USER_ID> format.

## Environment
${envDescription}

## Workspace Layout
${workspaceLayout}

## Skills (Custom CLI Tools)
You can create reusable CLI tools for recurring tasks (email, APIs, data processing, etc.).
Store in \`${workspacePath}/skills/<name>/\` or \`${channelPath}/skills/<name>/\`.
Each skill needs a \`SKILL.md\` documenting usage. Read it before using a skill.
List skills in global memory so you remember them.

## Memory
Write to MEMORY.md files to persist context across conversations.
- Global (${workspacePath}/MEMORY.md): skills, preferences, project info
- Channel (${channelPath}/MEMORY.md): channel-specific decisions, ongoing work
Update when you learn something important or when asked to remember something.

### Current Memory
${memory}

## Log Queries (CRITICAL: limit output to avoid context overflow)
Format: \`{"date":"...","ts":"...","user":"...","userName":"...","text":"...","isBot":false}\`
The log contains user messages AND your tool calls/results. Filter appropriately.
${isDocker ? "Install jq: apk add jq" : ""}

**Conversation only (excludes tool calls/results) - use for summaries:**
\`\`\`bash
grep -v '"text":"\\[Tool' log.jsonl | tail -30 | jq -c '{date: .date[0:19], user: (.userName // .user), text}'
\`\`\`

## Tools
- bash: Run shell commands (primary tool). Install packages as needed.
- read: Read files
- write: Create/overwrite files
- edit: Surgical file edits
- attach: Share files to Discord

Each tool requires a "label" parameter (shown to user).
`;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.substring(0, maxLen - 3) + "...";
}

function extractToolResultText(result: unknown): string {
	if (typeof result === "string") {
		return result;
	}

	if (
		result &&
		typeof result === "object" &&
		"content" in result &&
		Array.isArray((result as { content: unknown }).content)
	) {
		const content = (result as { content: Array<{ type: string; text?: string }> }).content;
		const textParts: string[] = [];
		for (const part of content) {
			if (part.type === "text" && part.text) {
				textParts.push(part.text);
			}
		}
		if (textParts.length > 0) {
			return textParts.join("\n");
		}
	}

	return JSON.stringify(result);
}

function formatToolArgsForDiscord(_toolName: string, args: Record<string, unknown>): string {
	const lines: string[] = [];

	for (const [key, value] of Object.entries(args)) {
		if (key === "label") continue;

		if (key === "path" && typeof value === "string") {
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			if (offset !== undefined && limit !== undefined) {
				lines.push(`${value}:${offset}-${offset + limit}`);
			} else {
				lines.push(value);
			}
			continue;
		}

		if (key === "offset" || key === "limit") continue;

		if (typeof value === "string") {
			lines.push(value);
		} else {
			lines.push(JSON.stringify(value));
		}
	}

	return lines.join("\n");
}

export function createAgentRunner(sandboxConfig: SandboxConfig): AgentRunner {
	let agent: Agent | null = null;
	const executor = createExecutor(sandboxConfig);

	return {
		async run(ctx: DiscordContext, channelDir: string, store: ChannelStore): Promise<{ stopReason: string }> {
			await mkdir(channelDir, { recursive: true });

			const channelId = ctx.message.channel;
			const guildId = ctx.message.guild;

			// Calculate workspace path
			const workspacePath = guildId
				? executor.getWorkspacePath(channelDir.replace(`/${guildId}/${channelId}`, ""))
				: executor.getWorkspacePath(channelDir.replace(`/${channelId}`, ""));

			const recentMessages = getRecentMessages(channelDir, 50);
			const memory = getMemory(channelDir);
			const systemPrompt = buildSystemPrompt(
				workspacePath,
				channelId,
				guildId,
				memory,
				sandboxConfig,
				ctx.channels,
				ctx.users,
			);

			log.logInfo(
				`Context sizes - system: ${systemPrompt.length} chars, messages: ${recentMessages.length} chars, memory: ${memory.length} chars`,
			);
			log.logInfo(`Channels: ${ctx.channels.length}, Users: ${ctx.users.length}`);

			setUploadFunction(async (filePath: string, title?: string) => {
				const hostPath = translateToHostPath(filePath, channelDir, workspacePath, channelId, guildId);
				await ctx.uploadFile(hostPath, title);
			});

			const tools = createMomTools(executor);

			agent = new Agent({
				initialState: {
					systemPrompt,
					model,
					thinkingLevel: "off",
					tools,
				},
				transport: new ProviderTransport({
					getApiKey: async () => getAnthropicApiKey(),
				}),
			});

			const logCtx = {
				channelId: ctx.message.channel,
				userName: ctx.message.userName,
				channelName: ctx.channelName,
				guildName: ctx.guildName,
			};

			const pendingTools = new Map<string, { toolName: string; args: unknown; startTime: number }>();

			const totalUsage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0,
				},
			};

			let stopReason = "stop";

			// Discord message limit is 2000 characters
			const DISCORD_MAX_LENGTH = 2000;
			const splitForDiscord = (text: string): string[] => {
				if (text.length <= DISCORD_MAX_LENGTH) return [text];
				const parts: string[] = [];
				let remaining = text;
				let partNum = 1;
				while (remaining.length > 0) {
					const chunk = remaining.substring(0, DISCORD_MAX_LENGTH - 50);
					remaining = remaining.substring(DISCORD_MAX_LENGTH - 50);
					const suffix = remaining.length > 0 ? `\n*(continued ${partNum}...)*` : "";
					parts.push(chunk + suffix);
					partNum++;
				}
				return parts;
			};

			const queue = {
				chain: Promise.resolve(),
				enqueue(fn: () => Promise<void>, errorContext: string): void {
					this.chain = this.chain.then(async () => {
						try {
							await fn();
						} catch (err) {
							const errMsg = err instanceof Error ? err.message : String(err);
							log.logWarning(`Discord API error (${errorContext})`, errMsg);
							try {
								await ctx.respondFollowUp(`*Error: ${errMsg}*`);
							} catch {
								// Ignore
							}
						}
					});
				},
				enqueueMessage(text: string, target: "main" | "followup", errorContext: string, shouldLog = true): void {
					const parts = splitForDiscord(text);
					for (const part of parts) {
						this.enqueue(
							() => (target === "main" ? ctx.respond(part, shouldLog) : ctx.respondFollowUp(part)),
							errorContext,
						);
					}
				},
				flush(): Promise<void> {
					return this.chain;
				},
			};

			agent.subscribe(async (event: AgentEvent) => {
				switch (event.type) {
					case "tool_execution_start": {
						const args = event.args as { label?: string };
						const label = args.label || event.toolName;

						pendingTools.set(event.toolCallId, {
							toolName: event.toolName,
							args: event.args,
							startTime: Date.now(),
						});

						log.logToolStart(logCtx, event.toolName, label, event.args as Record<string, unknown>);

						await store.logMessage(
							ctx.message.channel,
							{
								date: new Date().toISOString(),
								ts: generateTs(),
								user: "bot",
								text: `[Tool] ${event.toolName}: ${JSON.stringify(event.args)}`,
								attachments: [],
								isBot: true,
							},
							ctx.message.guild,
						);

						queue.enqueue(() => ctx.respond(`*→ ${label}*`, false), "tool label");
						break;
					}

					case "tool_execution_end": {
						const resultStr = extractToolResultText(event.result);
						const pending = pendingTools.get(event.toolCallId);
						pendingTools.delete(event.toolCallId);

						const durationMs = pending ? Date.now() - pending.startTime : 0;

						if (event.isError) {
							log.logToolError(logCtx, event.toolName, durationMs, resultStr);
						} else {
							log.logToolSuccess(logCtx, event.toolName, durationMs, resultStr);
						}

						await store.logMessage(
							ctx.message.channel,
							{
								date: new Date().toISOString(),
								ts: generateTs(),
								user: "bot",
								text: `[Tool Result] ${event.toolName}: ${event.isError ? "ERROR: " : ""}${truncate(resultStr, 1000)}`,
								attachments: [],
								isBot: true,
							},
							ctx.message.guild,
						);

						// Post detailed result as embed
						const label = pending?.args ? (pending.args as { label?: string }).label : undefined;
						const argsFormatted = pending
							? formatToolArgsForDiscord(event.toolName, pending.args as Record<string, unknown>)
							: "";
						const duration = (durationMs / 1000).toFixed(1);

						queue.enqueue(
							() =>
								ctx.respondToolEmbed({
									toolName: event.toolName,
									label,
									args: argsFormatted,
									result: resultStr,
									isError: event.isError,
									durationSecs: duration,
								}),
							"tool result embed",
						);

						if (event.isError) {
							queue.enqueue(() => ctx.respond(`*Error: ${truncate(resultStr, 200)}*`, false), "tool error");
						}
						break;
					}

					case "message_update":
						break;

					case "message_start":
						if (event.message.role === "assistant") {
							log.logResponseStart(logCtx);
						}
						break;

					case "message_end":
						if (event.message.role === "assistant") {
							const assistantMsg = event.message as any;

							if (assistantMsg.stopReason) {
								stopReason = assistantMsg.stopReason;
							}

							if (assistantMsg.usage) {
								totalUsage.input += assistantMsg.usage.input;
								totalUsage.output += assistantMsg.usage.output;
								totalUsage.cacheRead += assistantMsg.usage.cacheRead;
								totalUsage.cacheWrite += assistantMsg.usage.cacheWrite;
								totalUsage.cost.input += assistantMsg.usage.cost.input;
								totalUsage.cost.output += assistantMsg.usage.cost.output;
								totalUsage.cost.cacheRead += assistantMsg.usage.cost.cacheRead;
								totalUsage.cost.cacheWrite += assistantMsg.usage.cost.cacheWrite;
								totalUsage.cost.total += assistantMsg.usage.cost.total;
							}

							const content = event.message.content;
							const thinkingParts: string[] = [];
							const textParts: string[] = [];
							for (const part of content) {
								if (part.type === "thinking") {
									thinkingParts.push(part.thinking);
								} else if (part.type === "text") {
									textParts.push(part.text);
								}
							}

							const text = textParts.join("\n");

							for (const thinking of thinkingParts) {
								log.logThinking(logCtx, thinking);
								queue.enqueueMessage(`*${thinking}*`, "main", "thinking main");
								queue.enqueueMessage(`*${thinking}*`, "followup", "thinking followup", false);
							}

							if (text.trim()) {
								log.logResponse(logCtx, text);
								queue.enqueueMessage(text, "main", "response main");
								queue.enqueueMessage(text, "followup", "response followup", false);
							}
						}
						break;
				}
			});

			const userPrompt =
				`Conversation history (last 50 turns). Respond to the last message.\n` +
				`Format: date TAB user TAB text TAB attachments\n\n` +
				recentMessages;

			const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
			const debugPrompt =
				`=== SYSTEM PROMPT (${systemPrompt.length} chars) ===\n\n${systemPrompt}\n\n` +
				`=== TOOL DEFINITIONS (${JSON.stringify(toolDefs).length} chars) ===\n\n${JSON.stringify(toolDefs, null, 2)}\n\n` +
				`=== USER PROMPT (${userPrompt.length} chars) ===\n\n${userPrompt}`;
			await writeFile(join(channelDir, "last_prompt.txt"), debugPrompt, "utf-8");

			// Add stop button while processing
			try {
				await ctx.addStopButton();
			} catch {
				// Ignore if button fails
			}

			await agent.prompt(userPrompt);

			await queue.flush();

			// Remove stop button when done
			try {
				await ctx.removeStopButton();
			} catch {
				// Ignore if button removal fails
			}

			const messages = agent.state.messages;
			const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
			const finalText =
				lastAssistant?.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n") || "";

			if (finalText.trim()) {
				try {
					const mainText =
						finalText.length > DISCORD_MAX_LENGTH
							? finalText.substring(0, DISCORD_MAX_LENGTH - 50) + "\n\n*(see follow-up for full response)*"
							: finalText;
					await ctx.replaceMessage(mainText);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					log.logWarning("Failed to replace message with final text", errMsg);
				}
			}

			if (totalUsage.cost.total > 0) {
				const summary = log.logUsageSummary(logCtx, totalUsage);
				queue.enqueue(() => ctx.respondFollowUp(summary), "usage summary");
				await queue.flush();
			}

			return { stopReason };
		},

		abort(): void {
			agent?.abort();
		},
	};
}

function translateToHostPath(
	containerPath: string,
	channelDir: string,
	workspacePath: string,
	channelId: string,
	guildId?: string,
): string {
	if (workspacePath === "/workspace") {
		// Docker mode
		const prefix = guildId ? `/workspace/${guildId}/${channelId}/` : `/workspace/${channelId}/`;
		if (containerPath.startsWith(prefix)) {
			return join(channelDir, containerPath.slice(prefix.length));
		}
		if (containerPath.startsWith("/workspace/")) {
			// Navigate up to workspace root
			const baseDir = guildId ? join(channelDir, "..", "..") : join(channelDir, "..");
			return join(baseDir, containerPath.slice("/workspace/".length));
		}
	}
	return containerPath;
}
