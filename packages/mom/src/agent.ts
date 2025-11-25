import { Agent, type AgentEvent, ProviderTransport } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, rmSync } from "fs";
import { mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import type { SlackContext } from "./slack.js";
import type { ChannelStore } from "./store.js";
import { momTools, setUploadFunction } from "./tools/index.js";

// Hardcoded model for now
const model = getModel("anthropic", "claude-opus-4-5");

export interface AgentRunner {
	run(ctx: SlackContext, channelDir: string, store: ChannelStore): Promise<void>;
	abort(): void;
}

function getAnthropicApiKey(): string {
	const key = process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
	if (!key) {
		throw new Error("ANTHROPIC_OAUTH_TOKEN or ANTHROPIC_API_KEY must be set");
	}
	return key;
}

function getRecentMessages(channelDir: string, count: number): string {
	const logPath = join(channelDir, "log.jsonl");
	if (!existsSync(logPath)) {
		return "(no message history yet)";
	}

	const content = readFileSync(logPath, "utf-8");
	const lines = content.trim().split("\n").filter(Boolean);
	const recentLines = lines.slice(-count);

	if (recentLines.length === 0) {
		return "(no message history yet)";
	}

	return recentLines.join("\n");
}

function buildSystemPrompt(channelDir: string, scratchpadDir: string, recentMessages: string): string {
	return `You are mom, a helpful Slack bot assistant.

## Communication Style
- Be concise and professional
- Do not use emojis unless the user communicates informally with you
- Get to the point quickly
- If you need clarification, ask directly
- Use Slack's mrkdwn format (NOT standard Markdown):
  - Bold: *text* (single asterisks)
  - Italic: _text_
  - Strikethrough: ~text~
  - Code: \`code\`
  - Code block: \`\`\`code\`\`\`
  - Links: <url|text>
  - Do NOT use **double asterisks** or [markdown](links)

## Channel Data
The channel's data directory is: ${channelDir}

### Message History
- File: ${channelDir}/log.jsonl
- Format: One JSON object per line (JSONL)
- Each line has: {"ts", "user", "userName", "displayName", "text", "attachments", "isBot"}
- "ts" is the Slack timestamp
- "user" is the user ID, "userName" is their handle, "displayName" is their full name
- "attachments" is an array of {"original", "local"} where "local" is the path relative to the working directory
- "isBot" is true for bot responses

### Recent Messages (last 50)
Below are the most recent messages. If you need more context, read ${channelDir}/log.jsonl directly.

${recentMessages}

### Attachments
Files shared in the channel are stored in: ${channelDir}/attachments/
The "local" field in attachments points to these files.

## Scratchpad
Your temporary working directory is: ${scratchpadDir}
Use this for any file operations. It will be deleted after you complete.

## Tools
You have access to: read, edit, write, bash, attach tools.
- read: Read files
- edit: Edit files
- write: Write new files
- bash: Run shell commands
- attach: Attach a file to your response (share files with the user)

Each tool requires a "label" parameter - this is a brief description of what you're doing that will be shown to the user.
Keep labels short and informative, e.g., "Reading message history" or "Searching for user's previous questions".

## Guidelines
- Be concise and helpful
- If you need more conversation history beyond the recent messages above, read log.jsonl
- Use the scratchpad for any temporary work

## CRITICAL
- DO NOT USE EMOJIS. KEEP YOUR RESPONSES AS SHORT AS POSSIBLE.
`;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.substring(0, maxLen - 3) + "...";
}

export function createAgentRunner(): AgentRunner {
	let agent: Agent | null = null;

	return {
		async run(ctx: SlackContext, channelDir: string, store: ChannelStore): Promise<void> {
			// Create scratchpad
			const scratchpadDir = await mkdtemp(join(tmpdir(), "mom-scratchpad-"));

			try {
				const recentMessages = getRecentMessages(channelDir, 50);
				const systemPrompt = buildSystemPrompt(channelDir, scratchpadDir, recentMessages);

				// Set up file upload function for the attach tool
				setUploadFunction(async (filePath: string, title?: string) => {
					await ctx.uploadFile(filePath, title);
				});

				// Create ephemeral agent
				agent = new Agent({
					initialState: {
						systemPrompt,
						model,
						thinkingLevel: "off",
						tools: momTools,
					},
					transport: new ProviderTransport({
						getApiKey: async () => getAnthropicApiKey(),
					}),
				});

				// Subscribe to events
				agent.subscribe(async (event: AgentEvent) => {
					switch (event.type) {
						case "tool_execution_start": {
							const args = event.args as { label?: string };
							const label = args.label || event.toolName;

							// Log to console
							console.log(`\n[Tool] ${event.toolName}: ${JSON.stringify(event.args)}`);

							// Log to jsonl
							await store.logMessage(ctx.message.channel, {
								ts: Date.now().toString(),
								user: "bot",
								text: `[Tool] ${event.toolName}: ${JSON.stringify(event.args)}`,
								attachments: [],
								isBot: true,
							});

							// Show only label to user (italic)
							await ctx.respond(`_${label}_`);
							break;
						}

						case "tool_execution_end": {
							const resultStr = typeof event.result === "string" ? event.result : JSON.stringify(event.result);

							// Log to console
							console.log(`[Tool Result] ${event.isError ? "ERROR: " : ""}${truncate(resultStr, 1000)}\n`);

							// Log to jsonl
							await store.logMessage(ctx.message.channel, {
								ts: Date.now().toString(),
								user: "bot",
								text: `[Tool Result] ${event.toolName}: ${event.isError ? "ERROR: " : ""}${truncate(resultStr, 1000)}`,
								attachments: [],
								isBot: true,
							});

							// Show brief status to user (only on error)
							if (event.isError) {
								await ctx.respond(`_Error: ${truncate(resultStr, 200)}_`);
							}
							break;
						}

						case "message_update": {
							const ev = event.assistantMessageEvent;
							// Stream deltas to console
							if (ev.type === "text_delta") {
								process.stdout.write(ev.delta);
							} else if (ev.type === "thinking_delta") {
								process.stdout.write(ev.delta);
							}
							break;
						}

						case "message_start":
							if (event.message.role === "assistant") {
								process.stdout.write("\n");
							}
							break;

						case "message_end":
							if (event.message.role === "assistant") {
								process.stdout.write("\n");
								// Extract text from assistant message
								const content = event.message.content;
								let text = "";
								for (const part of content) {
									if (part.type === "text") {
										text += part.text;
									}
								}
								if (text.trim()) {
									await ctx.respond(text);
								}
							}
							break;
					}
				});

				// Run the agent with user's message
				await agent.prompt(ctx.message.text || "(attached files)");
			} finally {
				agent = null;
				// Cleanup scratchpad
				try {
					rmSync(scratchpadDir, { recursive: true, force: true });
				} catch {
					// Ignore cleanup errors
				}
			}
		},

		abort(): void {
			agent?.abort();
		},
	};
}
