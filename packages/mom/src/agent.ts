import { Agent, type AgentEvent, ProviderTransport } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { AgentSession, messageTransformer } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { MomSessionManager, MomSettingsManager } from "./context.js";
import * as log from "./log.js";
import { createExecutor, type SandboxConfig } from "./sandbox.js";
import type { ChannelInfo, SlackContext, UserInfo } from "./slack.js";
import type { ChannelStore } from "./store.js";
import { createMomTools, setUploadFunction } from "./tools/index.js";

// Hardcoded model for now - TODO: make configurable (issue #63)
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
		tsCounter++;
	} else {
		lastTsMs = now;
		tsCounter = 0;
	}
	const seconds = Math.floor(now / 1000);
	const micros = (now % 1000) * 1000 + tsCounter;
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

	return `You are mom, a Slack bot assistant. Be concise. No emojis.

## Context
- For current date/time, use: date
- You have access to previous conversation context including tool results from prior turns.
- For older history beyond your context, search log.jsonl (contains user messages and your final responses, but not tool results).

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
    ├── log.jsonl                # Message history (no tool results)
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

## System Configuration Log
Maintain ${workspacePath}/SYSTEM.md to log all environment modifications:
- Installed packages (apk add, npm install, pip install)
- Environment variables set
- Config files modified (~/.gitconfig, cron jobs, etc.)
- Skill dependencies installed

Update this file whenever you modify the environment. On fresh container, read it first to restore your setup.

## Log Queries (for older history)
Format: \`{"date":"...","ts":"...","user":"...","userName":"...","text":"...","isBot":false}\`
The log contains user messages and your final responses (not tool calls/results).
${isDocker ? "Install jq: apk add jq" : ""}

\`\`\`bash
# Recent messages
tail -30 log.jsonl | jq -c '{date: .date[0:19], user: (.userName // .user), text}'

# Search for specific topic
grep -i "topic" log.jsonl | jq -c '{date: .date[0:19], user: (.userName // .user), text}'

# Messages from specific user
grep '"userName":"mario"' log.jsonl | tail -20 | jq -c '{date: .date[0:19], text}'
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

function formatToolArgsForSlack(_toolName: string, args: Record<string, unknown>): string {
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

// Cache for AgentSession and SessionManager per channel
const channelSessions = new Map<string, { session: AgentSession; sessionManager: MomSessionManager }>();

export function createAgentRunner(sandboxConfig: SandboxConfig): AgentRunner {
	let currentSession: AgentSession | null = null;
	const executor = createExecutor(sandboxConfig);

	return {
		async run(ctx: SlackContext, channelDir: string, _store: ChannelStore): Promise<{ stopReason: string }> {
			// Ensure channel directory exists
			await mkdir(channelDir, { recursive: true });

			const channelId = ctx.message.channel;
			const workspacePath = executor.getWorkspacePath(channelDir.replace(`/${channelId}`, ""));

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
			log.logInfo(`Context sizes - system: ${systemPrompt.length} chars, memory: ${memory.length} chars`);
			log.logInfo(`Channels: ${ctx.channels.length}, Users: ${ctx.users.length}`);

			// Set up file upload function for the attach tool
			setUploadFunction(async (filePath: string, title?: string) => {
				const hostPath = translateToHostPath(filePath, channelDir, workspacePath, channelId);
				await ctx.uploadFile(hostPath, title);
			});

			// Create tools with executor
			const tools = createMomTools(executor);

			// Get or create AgentSession for this channel
			const cached = channelSessions.get(channelId);
			let session: AgentSession;
			let sessionManager: MomSessionManager;

			if (!cached) {
				// Create session manager and settings manager
				sessionManager = new MomSessionManager(channelDir);
				const settingsManager = new MomSettingsManager(join(channelDir, ".."));

				// Create agent with proper message transformer for compaction
				const agent = new Agent({
					initialState: {
						systemPrompt,
						model,
						thinkingLevel: "off",
						tools,
					},
					messageTransformer,
					transport: new ProviderTransport({
						getApiKey: async () => getAnthropicApiKey(),
					}),
				});

				// Load existing messages from session
				const loadedSession = sessionManager.loadSession();
				if (loadedSession.messages.length > 0) {
					agent.replaceMessages(loadedSession.messages);
					log.logInfo(`Loaded ${loadedSession.messages.length} messages from context.jsonl`);
				}

				// Create AgentSession wrapper
				session = new AgentSession({
					agent,
					sessionManager: sessionManager as any, // Type compatibility
					settingsManager: settingsManager as any, // Type compatibility
				});

				channelSessions.set(channelId, { session, sessionManager });
			} else {
				session = cached.session;
				sessionManager = cached.sessionManager;

				// Update system prompt for existing session (memory may have changed)
				session.agent.setSystemPrompt(systemPrompt);
			}

			// Sync messages from log.jsonl to context.jsonl
			// Exclude the current message - it will be added via prompt()
			sessionManager.syncFromLog(ctx.message.ts);

			currentSession = session;

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

			// Slack message limit is 40,000 characters
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
			const queue = {
				chain: Promise.resolve(),
				enqueue(fn: () => Promise<void>, errorContext: string): void {
					this.chain = this.chain.then(async () => {
						try {
							await fn();
						} catch (err) {
							const errMsg = err instanceof Error ? err.message : String(err);
							log.logWarning(`Slack API error (${errorContext})`, errMsg);
							try {
								await ctx.respondInThread(`_Error: ${errMsg}_`);
							} catch {
								// Ignore
							}
						}
					});
				},
				enqueueMessage(text: string, target: "main" | "thread", errorContext: string, doLog = true): void {
					const parts = splitForSlack(text);
					for (const part of parts) {
						this.enqueue(
							() => (target === "main" ? ctx.respond(part, doLog) : ctx.respondInThread(part)),
							errorContext,
						);
					}
				},
				flush(): Promise<void> {
					return this.chain;
				},
			};

			// Subscribe to session events
			const unsubscribe = session.subscribe(async (event) => {
				// Handle agent events
				if (event.type === "tool_execution_start") {
					const agentEvent = event as AgentEvent & { type: "tool_execution_start" };
					const args = agentEvent.args as { label?: string };
					const label = args.label || agentEvent.toolName;

					pendingTools.set(agentEvent.toolCallId, {
						toolName: agentEvent.toolName,
						args: agentEvent.args,
						startTime: Date.now(),
					});

					log.logToolStart(logCtx, agentEvent.toolName, label, agentEvent.args as Record<string, unknown>);

					// NOTE: Tool results are NOT logged to log.jsonl anymore
					// They are stored in context.jsonl via AgentSession

					queue.enqueue(() => ctx.respond(`_→ ${label}_`, false), "tool label");
				} else if (event.type === "tool_execution_end") {
					const agentEvent = event as AgentEvent & { type: "tool_execution_end" };
					const resultStr = extractToolResultText(agentEvent.result);
					const pending = pendingTools.get(agentEvent.toolCallId);
					pendingTools.delete(agentEvent.toolCallId);

					const durationMs = pending ? Date.now() - pending.startTime : 0;

					if (agentEvent.isError) {
						log.logToolError(logCtx, agentEvent.toolName, durationMs, resultStr);
					} else {
						log.logToolSuccess(logCtx, agentEvent.toolName, durationMs, resultStr);
					}

					// Post args + result to thread (for debugging)
					const label = pending?.args ? (pending.args as { label?: string }).label : undefined;
					const argsFormatted = pending
						? formatToolArgsForSlack(agentEvent.toolName, pending.args as Record<string, unknown>)
						: "(args not found)";
					const duration = (durationMs / 1000).toFixed(1);
					let threadMessage = `*${agentEvent.isError ? "✗" : "✓"} ${agentEvent.toolName}*`;
					if (label) {
						threadMessage += `: ${label}`;
					}
					threadMessage += ` (${duration}s)\n`;

					if (argsFormatted) {
						threadMessage += "```\n" + argsFormatted + "\n```\n";
					}

					threadMessage += "*Result:*\n```\n" + resultStr + "\n```";

					queue.enqueueMessage(threadMessage, "thread", "tool result thread", false);

					if (agentEvent.isError) {
						queue.enqueue(() => ctx.respond(`_Error: ${truncate(resultStr, 200)}_`, false), "tool error");
					}
				} else if (event.type === "message_start") {
					const agentEvent = event as AgentEvent & { type: "message_start" };
					if (agentEvent.message.role === "assistant") {
						log.logResponseStart(logCtx);
					}
				} else if (event.type === "message_end") {
					const agentEvent = event as AgentEvent & { type: "message_end" };
					if (agentEvent.message.role === "assistant") {
						const assistantMsg = agentEvent.message as any;

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

						const content = agentEvent.message.content;
						const thinkingParts: string[] = [];
						const textParts: string[] = [];
						for (const part of content) {
							if (part.type === "thinking") {
								thinkingParts.push((part as any).thinking);
							} else if (part.type === "text") {
								textParts.push((part as any).text);
							}
						}

						const text = textParts.join("\n");

						for (const thinking of thinkingParts) {
							log.logThinking(logCtx, thinking);
							queue.enqueueMessage(`_${thinking}_`, "main", "thinking main");
							queue.enqueueMessage(`_${thinking}_`, "thread", "thinking thread", false);
						}

						if (text.trim()) {
							log.logResponse(logCtx, text);
							queue.enqueueMessage(text, "main", "response main");
							queue.enqueueMessage(text, "thread", "response thread", false);
						}
					}
				} else if (event.type === "auto_compaction_start") {
					log.logInfo(`Auto-compaction started (reason: ${(event as any).reason})`);
					queue.enqueue(() => ctx.respond("_Compacting context..._", false), "compaction start");
				} else if (event.type === "auto_compaction_end") {
					const compEvent = event as any;
					if (compEvent.result) {
						log.logInfo(`Auto-compaction complete: ${compEvent.result.tokensBefore} tokens compacted`);
					} else if (compEvent.aborted) {
						log.logInfo("Auto-compaction aborted");
					}
				} else if (event.type === "auto_retry_start") {
					const retryEvent = event as any;
					log.logWarning(`Retrying (${retryEvent.attempt}/${retryEvent.maxAttempts})`, retryEvent.errorMessage);
					queue.enqueue(
						() => ctx.respond(`_Retrying (${retryEvent.attempt}/${retryEvent.maxAttempts})..._`, false),
						"retry",
					);
				}
			});

			try {
				// Build user message from Slack context
				// Note: User message is already logged to log.jsonl by Slack event handler
				const userMessage = ctx.message.text;

				// Send prompt to agent session
				await session.prompt(userMessage);

				// Wait for all queued Slack messages
				await queue.flush();

				// Get final assistant text and update main message
				const messages = session.messages;
				const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
				const finalText =
					lastAssistant?.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n") || "";

				if (finalText.trim()) {
					// Note: Bot response is logged via ctx.respond() in the event handler
					try {
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

				// Log usage summary
				if (totalUsage.cost.total > 0) {
					const summary = log.logUsageSummary(logCtx, totalUsage);
					queue.enqueue(() => ctx.respondInThread(summary), "usage summary");
					await queue.flush();
				}

				return { stopReason };
			} finally {
				unsubscribe();
			}
		},

		abort(): void {
			currentSession?.abort();
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
		const prefix = `/workspace/${channelId}/`;
		if (containerPath.startsWith(prefix)) {
			return join(channelDir, containerPath.slice(prefix.length));
		}
		if (containerPath.startsWith("/workspace/")) {
			return join(channelDir, "..", containerPath.slice("/workspace/".length));
		}
	}
	return containerPath;
}
