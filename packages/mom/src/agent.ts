import { Agent, type AgentEvent, ProviderTransport } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import * as log from "./log.js";
import { createExecutor, type SandboxConfig } from "./sandbox.js";
import type { ChannelInfo, SlackContext, UserInfo } from "./slack.js";
import type { ChannelStore } from "./store.js";
import { createMomTools, setUploadFunction } from "./tools/index.js";

// Hardcoded model for now
const model = getModel("anthropic", "claude-sonnet-4-5");

/**
 * Convert Date.now() to Slack timestamp format (seconds.microseconds)
 * Uses a monotonic counter to ensure ordering even within the same millisecond
 */
let lastTsMs = 0;
let tsCounter = 0;

function toSlackTs(): string {
	const now = Date.now();
	if (now === lastTsMs) {
		// Same millisecond - increment counter for sub-ms ordering
		tsCounter++;
	} else {
		// New millisecond - reset counter
		lastTsMs = now;
		tsCounter = 0;
	}
	const seconds = Math.floor(now / 1000);
	const micros = (now % 1000) * 1000 + tsCounter; // ms to micros + counter
	return `${seconds}.${micros.toString().padStart(6, "0")}`;
}

export interface AgentRunner {
	run(ctx: SlackContext, channelDir: string, store: ChannelStore): Promise<{ stopReason: string }>;
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

	// Parse all messages and sort by Slack timestamp
	// (attachment downloads can cause out-of-order logging)
	const messages: LogMessage[] = [];
	for (const line of lines) {
		try {
			messages.push(JSON.parse(line));
		} catch {}
	}
	messages.sort((a, b) => {
		const tsA = parseFloat(a.ts || "0");
		const tsB = parseFloat(b.ts || "0");
		return tsA - tsB;
	});

	// Group into "turns" - a turn is either:
	// - A single user message (isBot: false)
	// - A sequence of consecutive bot messages (isBot: true) coalesced into one turn
	// We walk backwards to get the last N turns
	const turns: LogMessage[][] = [];
	let currentTurn: LogMessage[] = [];
	let lastWasBot: boolean | null = null;

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		const isBot = msg.isBot === true;

		if (lastWasBot === null) {
			// First message
			currentTurn.unshift(msg);
			lastWasBot = isBot;
		} else if (isBot && lastWasBot) {
			// Consecutive bot messages - same turn
			currentTurn.unshift(msg);
		} else {
			// Transition - save current turn and start new one
			turns.unshift(currentTurn);
			currentTurn = [msg];
			lastWasBot = isBot;

			// Stop if we have enough turns
			if (turns.length >= turnCount) {
				break;
			}
		}
	}

	// Don't forget the last turn we were building
	if (currentTurn.length > 0 && turns.length < turnCount) {
		turns.unshift(currentTurn);
	}

	// Flatten turns back to messages and format as TSV
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

	// Read workspace-level memory (shared across all channels)
	const workspaceMemoryPath = join(channelDir, "..", "MEMORY.md");
	if (existsSync(workspaceMemoryPath)) {
		try {
			const content = readFileSync(workspaceMemoryPath, "utf-8").trim();
			if (content) {
				parts.push("### Global Workspace Memory\n" + content);
			}
		} catch (error) {
			log.logWarning("Failed to read workspace memory", `${workspaceMemoryPath}: ${error}`);
		}
	}

	// Read channel-specific memory
	const channelMemoryPath = join(channelDir, "MEMORY.md");
	if (existsSync(channelMemoryPath)) {
		try {
			const content = readFileSync(channelMemoryPath, "utf-8").trim();
			if (content) {
				parts.push("### Channel-Specific Memory\n" + content);
			}
		} catch (error) {
			log.logWarning("Failed to read channel memory", `${channelMemoryPath}: ${error}`);
		}
	}

	if (parts.length === 0) {
		return "(no working memory yet)";
	}

	return parts.join("\n\n");
}

function buildSystemPrompt(
	workspacePath: string,
	channelId: string,
	memory: string,
	sandboxConfig: SandboxConfig,
	channels: ChannelInfo[],
	users: UserInfo[],
): string {
	const channelPath = `${workspacePath}/${channelId}`;
	const isDocker = sandboxConfig.type === "docker";

	// Format channel mappings
	const channelMappings =
		channels.length > 0 ? channels.map((c) => `${c.id}\t#${c.name}`).join("\n") : "(no channels loaded)";

	// Format user mappings
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

	const currentDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
	const currentDateTime = new Date().toISOString(); // Full ISO 8601

	return `You are mom, a Slack bot assistant. Be concise. No emojis.

## Context
- Date: ${currentDate} (${currentDateTime})
- You receive the last 50 conversation turns. If you need older context, search log.jsonl.

## Slack Formatting (mrkdwn, NOT Markdown)
Bold: *text*, Italic: _text_, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: <url|text>
Do NOT use **double asterisks** or [markdown](links).

## Slack IDs
Channels: ${channelMappings}

Users: ${userMappings}

When mentioning users, use <@username> format (e.g., <@mario>).

## Environment
${envDescription}

## Workspace Layout
${workspacePath}/
├── MEMORY.md                    # Global memory (all channels)
├── skills/                      # Global CLI tools you create
└── ${channelId}/                # This channel
    ├── MEMORY.md                # Channel-specific memory
    ├── log.jsonl                # Full message history
    ├── attachments/             # User-shared files
    ├── scratch/                 # Your working directory
    └── skills/                  # Channel-specific tools

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
# Recent conversation (no [Tool] or [Tool Result] lines)
grep -v '"text":"\\[Tool' log.jsonl | tail -30 | jq -c '{date: .date[0:19], user: (.userName // .user), text}'

# Yesterday's conversation
grep '"date":"2025-11-26' log.jsonl | grep -v '"text":"\\[Tool' | jq -c '{date: .date[0:19], user: (.userName // .user), text}'

# Specific user's messages
grep '"userName":"mario"' log.jsonl | grep -v '"text":"\\[Tool' | tail -20 | jq -c '{date: .date[0:19], text}'
\`\`\`

**Full details (includes tool calls) - use when you need technical context:**
\`\`\`bash
# Raw recent entries
tail -20 log.jsonl | jq -c '{date: .date[0:19], user: (.userName // .user), text}'

# Count all messages
wc -l log.jsonl
\`\`\`

## Tools
- bash: Run shell commands (primary tool). Install packages as needed.
- read: Read files
- write: Create/overwrite files  
- edit: Surgical file edits
- attach: Share files to Slack

Each tool requires a "label" parameter (shown to user).
`;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.substring(0, maxLen - 3) + "...";
}

function extractToolResultText(result: unknown): string {
	// If it's already a string, return it
	if (typeof result === "string") {
		return result;
	}

	// If it's an object with content array (tool result format)
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

	// Fallback to JSON
	return JSON.stringify(result);
}

function formatToolArgsForSlack(_toolName: string, args: Record<string, unknown>): string {
	const lines: string[] = [];

	for (const [key, value] of Object.entries(args)) {
		// Skip the label - it's already shown
		if (key === "label") continue;

		// For read tool, format path with offset/limit
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

		// Skip offset/limit since we already handled them
		if (key === "offset" || key === "limit") continue;

		// For other values, format them
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
		async run(ctx: SlackContext, channelDir: string, store: ChannelStore): Promise<{ stopReason: string }> {
			// Ensure channel directory exists
			await mkdir(channelDir, { recursive: true });

			const channelId = ctx.message.channel;
			const workspacePath = executor.getWorkspacePath(channelDir.replace(`/${channelId}`, ""));
			const recentMessages = getRecentMessages(channelDir, 50);
			const memory = getMemory(channelDir);
			const systemPrompt = buildSystemPrompt(
				workspacePath,
				channelId,
				memory,
				sandboxConfig,
				ctx.channels,
				ctx.users,
			);

			// Debug: log context sizes
			log.logInfo(
				`Context sizes - system: ${systemPrompt.length} chars, messages: ${recentMessages.length} chars, memory: ${memory.length} chars`,
			);
			log.logInfo(`Channels: ${ctx.channels.length}, Users: ${ctx.users.length}`);

			// Set up file upload function for the attach tool
			// For Docker, we need to translate paths back to host
			setUploadFunction(async (filePath: string, title?: string) => {
				const hostPath = translateToHostPath(filePath, channelDir, workspacePath, channelId);
				await ctx.uploadFile(hostPath, title);
			});

			// Create tools with executor
			const tools = createMomTools(executor);

			// Create ephemeral agent
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

			// Create logging context
			const logCtx = {
				channelId: ctx.message.channel,
				userName: ctx.message.userName,
				channelName: ctx.channelName,
			};

			// Track pending tool calls to pair args with results and timing
			const pendingTools = new Map<string, { toolName: string; args: unknown; startTime: number }>();

			// Track usage across all assistant messages in this run
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

			// Track stop reason
			let stopReason = "stop";

			// Slack message limit is 40,000 characters - split into multiple messages if needed
			const SLACK_MAX_LENGTH = 40000;
			const splitForSlack = (text: string): string[] => {
				if (text.length <= SLACK_MAX_LENGTH) return [text];
				const parts: string[] = [];
				let remaining = text;
				let partNum = 1;
				while (remaining.length > 0) {
					const chunk = remaining.substring(0, SLACK_MAX_LENGTH - 50);
					remaining = remaining.substring(SLACK_MAX_LENGTH - 50);
					const suffix = remaining.length > 0 ? `\n_(continued ${partNum}...)_` : "";
					parts.push(chunk + suffix);
					partNum++;
				}
				return parts;
			};

			// Promise queue to ensure ctx.respond/respondInThread calls execute in order
			// Handles errors gracefully by posting to thread instead of crashing
			const queue = {
				chain: Promise.resolve(),
				enqueue(fn: () => Promise<void>, errorContext: string): void {
					this.chain = this.chain.then(async () => {
						try {
							await fn();
						} catch (err) {
							const errMsg = err instanceof Error ? err.message : String(err);
							log.logWarning(`Slack API error (${errorContext})`, errMsg);
							// Try to post error to thread, but don't crash if that fails too
							try {
								await ctx.respondInThread(`_Error: ${errMsg}_`);
							} catch {
								// Ignore - we tried our best
							}
						}
					});
				},
				// Enqueue a message that may need splitting
				enqueueMessage(text: string, target: "main" | "thread", errorContext: string, log = true): void {
					const parts = splitForSlack(text);
					for (const part of parts) {
						this.enqueue(
							() => (target === "main" ? ctx.respond(part, log) : ctx.respondInThread(part)),
							errorContext,
						);
					}
				},
				flush(): Promise<void> {
					return this.chain;
				},
			};

			// Subscribe to events
			agent.subscribe(async (event: AgentEvent) => {
				switch (event.type) {
					case "tool_execution_start": {
						const args = event.args as { label?: string };
						const label = args.label || event.toolName;

						// Store args to pair with result later
						pendingTools.set(event.toolCallId, {
							toolName: event.toolName,
							args: event.args,
							startTime: Date.now(),
						});

						// Log to console
						log.logToolStart(logCtx, event.toolName, label, event.args as Record<string, unknown>);

						// Log to jsonl
						await store.logMessage(ctx.message.channel, {
							date: new Date().toISOString(),
							ts: toSlackTs(),
							user: "bot",
							text: `[Tool] ${event.toolName}: ${JSON.stringify(event.args)}`,
							attachments: [],
							isBot: true,
						});

						// Show label in main message only
						queue.enqueue(() => ctx.respond(`_→ ${label}_`, false), "tool label");
						break;
					}

					case "tool_execution_end": {
						const resultStr = extractToolResultText(event.result);
						const pending = pendingTools.get(event.toolCallId);
						pendingTools.delete(event.toolCallId);

						const durationMs = pending ? Date.now() - pending.startTime : 0;

						// Log to console
						if (event.isError) {
							log.logToolError(logCtx, event.toolName, durationMs, resultStr);
						} else {
							log.logToolSuccess(logCtx, event.toolName, durationMs, resultStr);
						}

						// Log to jsonl
						await store.logMessage(ctx.message.channel, {
							date: new Date().toISOString(),
							ts: toSlackTs(),
							user: "bot",
							text: `[Tool Result] ${event.toolName}: ${event.isError ? "ERROR: " : ""}${truncate(resultStr, 1000)}`,
							attachments: [],
							isBot: true,
						});

						// Post args + result together in thread
						const label = pending?.args ? (pending.args as { label?: string }).label : undefined;
						const argsFormatted = pending
							? formatToolArgsForSlack(event.toolName, pending.args as Record<string, unknown>)
							: "(args not found)";
						const duration = (durationMs / 1000).toFixed(1);
						let threadMessage = `*${event.isError ? "✗" : "✓"} ${event.toolName}*`;
						if (label) {
							threadMessage += `: ${label}`;
						}
						threadMessage += ` (${duration}s)\n`;

						if (argsFormatted) {
							threadMessage += "```\n" + argsFormatted + "\n```\n";
						}

						threadMessage += "*Result:*\n```\n" + resultStr + "\n```";

						queue.enqueueMessage(threadMessage, "thread", "tool result thread", false);

						// Show brief error in main message if failed
						if (event.isError) {
							queue.enqueue(() => ctx.respond(`_Error: ${truncate(resultStr, 200)}_`, false), "tool error");
						}
						break;
					}

					case "message_update": {
						// No longer stream to console - just track that we're streaming
						break;
					}

					case "message_start":
						if (event.message.role === "assistant") {
							log.logResponseStart(logCtx);
						}
						break;

					case "message_end":
						if (event.message.role === "assistant") {
							const assistantMsg = event.message as any; // AssistantMessage type

							// Track stop reason
							if (assistantMsg.stopReason) {
								stopReason = assistantMsg.stopReason;
							}

							// Accumulate usage
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

							// Extract thinking and text from assistant message
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

							// Post thinking to main message and thread
							for (const thinking of thinkingParts) {
								log.logThinking(logCtx, thinking);
								queue.enqueueMessage(`_${thinking}_`, "main", "thinking main");
								queue.enqueueMessage(`_${thinking}_`, "thread", "thinking thread", false);
							}

							// Post text to main message and thread
							if (text.trim()) {
								log.logResponse(logCtx, text);
								queue.enqueueMessage(text, "main", "response main");
								queue.enqueueMessage(text, "thread", "response thread", false);
							}
						}
						break;
				}
			});

			// Run the agent with user's message
			// Prepend recent messages to the user prompt (not system prompt) for better caching
			// The current message is already the last entry in recentMessages
			const userPrompt =
				`Conversation history (last 50 turns). Respond to the last message.\n` +
				`Format: date TAB user TAB text TAB attachments\n\n` +
				recentMessages;
			// Debug: write full context to file
			const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
			const debugPrompt =
				`=== SYSTEM PROMPT (${systemPrompt.length} chars) ===\n\n${systemPrompt}\n\n` +
				`=== TOOL DEFINITIONS (${JSON.stringify(toolDefs).length} chars) ===\n\n${JSON.stringify(toolDefs, null, 2)}\n\n` +
				`=== USER PROMPT (${userPrompt.length} chars) ===\n\n${userPrompt}`;
			await writeFile(join(channelDir, "last_prompt.txt"), debugPrompt, "utf-8");

			await agent.prompt(userPrompt);

			// Wait for all queued respond calls to complete
			await queue.flush();

			// Get final assistant message text from agent state and replace main message
			const messages = agent.state.messages;
			const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
			const finalText =
				lastAssistant?.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n") || "";
			if (finalText.trim()) {
				try {
					// For the main message, truncate if too long (full text is in thread)
					const mainText =
						finalText.length > SLACK_MAX_LENGTH
							? finalText.substring(0, SLACK_MAX_LENGTH - 50) + "\n\n_(see thread for full response)_"
							: finalText;
					await ctx.replaceMessage(mainText);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					log.logWarning("Failed to replace message with final text", errMsg);
				}
			}

			// Log usage summary if there was any usage
			if (totalUsage.cost.total > 0) {
				const summary = log.logUsageSummary(logCtx, totalUsage);
				queue.enqueue(() => ctx.respondInThread(summary), "usage summary");
				await queue.flush();
			}

			return { stopReason };
		},

		abort(): void {
			agent?.abort();
		},
	};
}

/**
 * Translate container path back to host path for file operations
 */
function translateToHostPath(
	containerPath: string,
	channelDir: string,
	workspacePath: string,
	channelId: string,
): string {
	if (workspacePath === "/workspace") {
		// Docker mode - translate /workspace/channelId/... to host path
		const prefix = `/workspace/${channelId}/`;
		if (containerPath.startsWith(prefix)) {
			return join(channelDir, containerPath.slice(prefix.length));
		}
		// Maybe it's just /workspace/...
		if (containerPath.startsWith("/workspace/")) {
			return join(channelDir, "..", containerPath.slice("/workspace/".length));
		}
	}
	// Host mode or already a host path
	return containerPath;
}
