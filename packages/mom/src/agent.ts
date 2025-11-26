import { Agent, type AgentEvent, ProviderTransport } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { existsSync, readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";

import { createExecutor, type SandboxConfig } from "./sandbox.js";
import type { SlackContext } from "./slack.js";
import type { ChannelStore } from "./store.js";
import { createMomTools, setUploadFunction } from "./tools/index.js";

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

function buildSystemPrompt(
	workspacePath: string,
	channelId: string,
	recentMessages: string,
	sandboxConfig: SandboxConfig,
): string {
	const channelPath = `${workspacePath}/${channelId}`;
	const isDocker = sandboxConfig.type === "docker";

	const envDescription = isDocker
		? `You are running inside a Docker container (Alpine Linux).
- Install tools with: apk add <package>
- Your changes persist across sessions
- You have full control over this container`
		: `You are running directly on the host machine.
- Be careful with system modifications
- Use the system's package manager if needed`;

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

## Your Environment
${envDescription}

## Your Workspace
Your working directory is: ${channelPath}

You can:
- Configure tools and save credentials
- Create files and directories as needed

### Channel Data
- Message history: ${channelPath}/log.jsonl (JSONL format)
- Attachments from users: ${channelPath}/attachments/

### Recent Messages (last 50)
${recentMessages}

## Tools
You have access to: bash, read, edit, write, attach tools.
- bash: Run shell commands (this is your main tool)
- read: Read files
- edit: Edit files surgically
- write: Create/overwrite files
- attach: Share a file with the user in Slack

Each tool requires a "label" parameter - brief description shown to the user.

## Guidelines
- Be concise and helpful
- Use bash for most operations
- If you need a tool, install it
- If you need credentials, ask the user

## CRITICAL
- DO NOT USE EMOJIS. KEEP YOUR RESPONSES AS SHORT AS POSSIBLE.
`;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.substring(0, maxLen - 3) + "...";
}

export function createAgentRunner(sandboxConfig: SandboxConfig): AgentRunner {
	let agent: Agent | null = null;
	const executor = createExecutor(sandboxConfig);

	return {
		async run(ctx: SlackContext, channelDir: string, store: ChannelStore): Promise<void> {
			// Ensure channel directory exists
			await mkdir(channelDir, { recursive: true });

			const channelId = ctx.message.channel;
			const workspacePath = executor.getWorkspacePath(channelDir.replace(`/${channelId}`, ""));
			const recentMessages = getRecentMessages(channelDir, 50);
			const systemPrompt = buildSystemPrompt(workspacePath, channelId, recentMessages, sandboxConfig);

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
