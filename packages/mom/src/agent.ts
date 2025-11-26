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

	// Format as TSV for more concise system prompt
	const formatted: string[] = [];
	for (const line of recentLines) {
		try {
			const msg = JSON.parse(line);
			const date = (msg.date || "").substring(0, 19);
			const user = msg.userName || msg.user;
			const text = msg.text || "";
			const attachments = (msg.attachments || []).map((a: { local: string }) => a.local).join(",");
			formatted.push(`${date}\t${user}\t${text}\t${attachments}`);
		} catch (error) {}
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
			console.error(`Failed to read workspace memory: ${error}`);
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
			console.error(`Failed to read channel memory: ${error}`);
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
	recentMessages: string,
	memory: string,
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

	const currentDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
	const currentDateTime = new Date().toISOString(); // Full ISO 8601

	return `You are mom, a helpful Slack bot assistant.

## Current Date and Time
- Date: ${currentDate}
- Full timestamp: ${currentDateTime}
- Use this when working with dates or searching logs

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

### Directory Structure
- ${workspacePath}/ - Root workspace (shared across all channels)
  - MEMORY.md - GLOBAL memory visible to all channels (write global info here)
  - ${channelId}/ - This channel's directory
    - MEMORY.md - CHANNEL-SPECIFIC memory (only visible in this channel)
    - scratch/ - Your working directory for files, repos, etc.
    - log.jsonl - Message history in JSONL format (one JSON object per line)
    - attachments/ - Files shared by users (managed by system, read-only)

### Message History Format
Each line in log.jsonl contains:
{
  "date": "2025-11-26T10:44:00.123Z",  // ISO 8601 - easy to grep by date!
  "ts": "1732619040.123456",            // Slack timestamp or epoch ms
  "user": "U123ABC",                     // User ID or "bot"
  "userName": "mario",                   // User handle (optional)
  "text": "message text",
  "isBot": false
}

**⚠️ CRITICAL: Efficient Log Queries (Avoid Context Overflow)**

Log files can be VERY LARGE (100K+ lines). The problem is getting too MANY messages, not message length.
Each message can be up to 10k chars - that's fine. Use head/tail to LIMIT NUMBER OF MESSAGES (10-50 at a time).

**Install jq first (if not already):**
\`\`\`bash
${isDocker ? "apk add jq" : "# jq should be available, or install via package manager"}
\`\`\`

**Essential query patterns:**
\`\`\`bash
# Last N messages (compact JSON output)
tail -20 log.jsonl | jq -c '{date: .date[0:19], user: (.userName // .user), text, attachments: [(.attachments // [])[].local]}'

# Or TSV format (easier to read)
tail -20 log.jsonl | jq -r '[.date[0:19], (.userName // .user), .text, ((.attachments // []) | map(.local) | join(","))] | @tsv'

# Search by date (LIMIT with head/tail!)
grep '"date":"2025-11-26' log.jsonl | tail -30 | jq -c '{date: .date[0:19], user: (.userName // .user), text, attachments: [(.attachments // [])[].local]}'

# Messages from specific user (count first, then limit)
grep '"userName":"mario"' log.jsonl | wc -l  # Check count first
grep '"userName":"mario"' log.jsonl | tail -20 | jq -c '{date: .date[0:19], user: .userName, text, attachments: [(.attachments // [])[].local]}'

# Only count (when you just need the number)
grep '"isBot":false' log.jsonl | wc -l

# Messages with attachments only (limit!)
grep '"attachments":[{' log.jsonl | tail -10 | jq -r '[.date[0:16], (.userName // .user), .text, (.attachments | map(.local) | join(","))] | @tsv'
\`\`\`

**KEY RULE:** Always pipe through 'head -N' or 'tail -N' to limit results BEFORE parsing with jq!
\`\`\`

**Date filtering:**
- Today: grep '"date":"${currentDate}' log.jsonl
- Yesterday: grep '"date":"2025-11-25' log.jsonl
- Date range: grep '"date":"2025-11-(26|27|28)' log.jsonl
- Time range: grep -E '"date":"2025-11-26T(09|10|11):' log.jsonl

### Working Memory System
You can maintain working memory across conversations by writing MEMORY.md files.

**IMPORTANT PATH RULES:**
- Global memory (all channels): ${workspacePath}/MEMORY.md
- Channel memory (this channel only): ${channelPath}/MEMORY.md

**What to remember:**
- Project details and architecture → Global memory
- User preferences and coding style → Global memory
- Channel-specific context → Channel memory
- Recurring tasks and patterns → Appropriate memory file
- Credentials locations (never actual secrets) → Global memory
- Decisions made and their rationale → Appropriate memory file

**When to update:**
- After learning something important that will help in future conversations
- When user asks you to remember something
- When you discover project structure or conventions

### Current Working Memory
${memory}

### Recent Messages (last 50)
Format: date TAB user TAB text TAB attachments
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
			const memory = getMemory(channelDir);
			const systemPrompt = buildSystemPrompt(workspacePath, channelId, recentMessages, memory, sandboxConfig);

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

			// Track pending tool calls to pair args with results
			const pendingTools = new Map<string, { toolName: string; args: unknown }>();

			// Subscribe to events
			agent.subscribe(async (event: AgentEvent) => {
				switch (event.type) {
					case "tool_execution_start": {
						const args = event.args as { label?: string };
						const label = args.label || event.toolName;

						// Store args to pair with result later
						pendingTools.set(event.toolCallId, { toolName: event.toolName, args: event.args });

						// Log to console
						console.log(`\n[Tool] ${event.toolName}: ${JSON.stringify(event.args)}`);

						// Log to jsonl
						await store.logMessage(ctx.message.channel, {
							date: new Date().toISOString(),
							ts: Date.now().toString(),
							user: "bot",
							text: `[Tool] ${event.toolName}: ${JSON.stringify(event.args)}`,
							attachments: [],
							isBot: true,
						});

						// Show label in main message only
						await ctx.respond(`_${label}_`);
						break;
					}

					case "tool_execution_end": {
						const resultStr = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
						const pending = pendingTools.get(event.toolCallId);
						pendingTools.delete(event.toolCallId);

						// Log to console
						console.log(`[Tool Result] ${event.isError ? "ERROR: " : ""}${truncate(resultStr, 1000)}\n`);

						// Log to jsonl
						await store.logMessage(ctx.message.channel, {
							date: new Date().toISOString(),
							ts: Date.now().toString(),
							user: "bot",
							text: `[Tool Result] ${event.toolName}: ${event.isError ? "ERROR: " : ""}${truncate(resultStr, 1000)}`,
							attachments: [],
							isBot: true,
						});

						// Post args + result together in thread
						const argsStr = pending ? JSON.stringify(pending.args, null, 2) : "(args not found)";
						const threadResult = truncate(resultStr, 2000);
						await ctx.respondInThread(
							`*[${event.toolName}]* ${event.isError ? "❌" : "✓"}\n` +
								"```\n" +
								argsStr +
								"\n```\n" +
								"*Result:*\n```\n" +
								threadResult +
								"\n```",
						);

						// Show brief error in main message if failed
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
