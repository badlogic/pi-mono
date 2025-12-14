import { Agent, type AgentEvent, ProviderTransport } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import {
	AgentSession,
	formatSkillsForPrompt,
	loadSkillsFromDir,
	messageTransformer,
	type Skill,
} from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { isAbsolute, join, relative, resolve } from "path";
import { MomSessionManager, MomSettingsManager, syncLogToContext } from "./context.js";
import * as log from "./log.js";
import { createExecutor, type SandboxConfig } from "./sandbox.js";
import { createMomTools } from "./tools/index.js";
import type { ChannelInfo, ToolResultData, TransportContext, TransportName, UserInfo } from "./transport/types.js";

// Hardcoded model for now - TODO: make configurable (issue #63)
const model = getModel("anthropic", "claude-sonnet-4-5");

export interface PendingMessage {
	userName: string;
	text: string;
	attachments: { local: string }[];
	timestamp: number;
}

export interface AgentRunner {
	run(
		ctx: TransportContext,
		pendingMessages?: PendingMessage[],
	): Promise<{ stopReason: string; errorMessage?: string }>;
	abort(): void;
}

function getAnthropicApiKey(): string {
	const key = process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
	if (!key) {
		throw new Error("ANTHROPIC_OAUTH_TOKEN or ANTHROPIC_API_KEY must be set");
	}
	return key;
}

function getMemory(workingDir: string, channelDir: string): string {
	const parts: string[] = [];

	// Read workspace-level memory (shared across all channels)
	const workspaceMemoryPath = join(workingDir, "MEMORY.md");
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

function loadMomSkills(workingDir: string, channelDir: string, workspacePath: string): Skill[] {
	const skillMap = new Map<string, Skill>();

	const hostWorkspacePath = workingDir;

	// Helper to translate host paths to container paths
	const translatePath = (hostPath: string): string => {
		if (hostPath.startsWith(hostWorkspacePath)) {
			return workspacePath + hostPath.slice(hostWorkspacePath.length);
		}
		return hostPath;
	};

	// Load workspace-level skills (global)
	const workspaceSkillsDir = join(hostWorkspacePath, "skills");
	for (const skill of loadSkillsFromDir({ dir: workspaceSkillsDir, source: "workspace" })) {
		// Translate paths to container paths for system prompt
		skill.filePath = translatePath(skill.filePath);
		skill.baseDir = translatePath(skill.baseDir);
		skillMap.set(skill.name, skill);
	}

	// Load channel-specific skills (override workspace skills on collision)
	const channelSkillsDir = join(channelDir, "skills");
	for (const skill of loadSkillsFromDir({ dir: channelSkillsDir, source: "channel" })) {
		skill.filePath = translatePath(skill.filePath);
		skill.baseDir = translatePath(skill.baseDir);
		skillMap.set(skill.name, skill);
	}

	return Array.from(skillMap.values());
}

function buildSystemPrompt(
	workspacePath: string,
	channelRelPath: string,
	memory: string,
	sandboxConfig: SandboxConfig,
	channels: ChannelInfo[],
	users: UserInfo[],
	skills: Skill[],
	transport: TransportName,
): string {
	const channelPath = `${workspacePath}/${channelRelPath}`;
	const channelIdForEvents = channelRelPath.split("/").pop() || channelRelPath;
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

	const toolAttachLabel = transport === "slack" ? "Share files to Slack" : "Share files to the chat";

	const formattingGuide =
		transport === "slack"
			? `## Slack Formatting (mrkdwn, NOT Markdown)
Bold: *text*, Italic: _text_, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: <url|text>
Do NOT use **double asterisks** or [markdown](links).`
			: `## Discord Formatting (Markdown)
Bold: **text**, Italic: *text*, Code: \`code\`, Block: \`\`\`code\`\`\`
Avoid Slack mrkdwn link format (<url|text>).`;

	const mentionGuide =
		transport === "slack"
			? `When mentioning users, use <@username> format (e.g., <@mario>).`
			: `When mentioning users, use <@USER_ID> format (e.g., <@1234567890>).`;

	const silentGuide =
		transport === "slack"
			? `For periodic events where there's nothing to report, respond with just \`[SILENT]\` (no other text). This deletes the status message and posts nothing to Slack. Use this to avoid spamming the channel when periodic checks find nothing actionable.`
			: `For periodic events where there's nothing to report, respond with just \`[SILENT]\` (no other text). This deletes the status message and posts nothing else. Use this to avoid spamming the channel when periodic checks find nothing actionable.`;

	return `You are mom, a ${transport === "slack" ? "Slack bot" : "Discord bot"} assistant. Be concise. No emojis.

## How to Respond
Your text responses are automatically delivered to the channel. Do NOT try to send messages via curl, API calls, webhooks, or any other method. Just write your response as normal text output.

## Context
- For current date/time, use: date
- You have access to previous conversation context including tool results from prior turns.
- For older history beyond your context, search log.jsonl (contains user messages and your final responses, but not tool results).

${formattingGuide}

## IDs
Channels: ${channelMappings}

Users: ${userMappings}

${mentionGuide}

## Environment
${envDescription}

## Workspace Layout
${workspacePath}/
├── MEMORY.md                    # Global memory (all channels)
├── skills/                      # Global CLI tools you create
└── ${channelRelPath}/           # This channel
    ├── MEMORY.md                # Channel-specific memory
    ├── log.jsonl                # Message history (no tool results)
    ├── context.jsonl             # LLM context (includes tool results)
    ├── attachments/             # User-shared files
    ├── scratch/                 # Your working directory
    └── skills/                  # Channel-specific tools

## Skills (Custom CLI Tools)
You can create reusable CLI tools for recurring tasks (email, APIs, data processing, etc.).

### Creating Skills
Store in \`${workspacePath}/skills/<name>/\` (global) or \`${channelPath}/skills/<name>/\` (channel-specific).
Each skill directory needs a \`SKILL.md\` with YAML frontmatter:

\`\`\`markdown
---
name: skill-name
description: Short description of what this skill does
---

# Skill Name

Usage instructions, examples, etc.
Scripts are in: {baseDir}/
\`\`\`

\`name\` and \`description\` are required. Use \`{baseDir}\` as placeholder for the skill's directory path.

	### Available Skills
	${skills.length > 0 ? formatSkillsForPrompt(skills) : "(no skills installed yet)"}

	${
		transport === "slack"
			? `## Events
You can schedule events that wake you up at specific times or when external things happen. Events are JSON files in \`${workspacePath}/events/\`.

### Event Types

**Immediate** - Triggers as soon as harness sees the file. Use in scripts/webhooks to signal external events.
\`\`\`json
{"type": "immediate", "channelId": "${channelIdForEvents}", "text": "New GitHub issue opened"}
\`\`\`

**One-shot** - Triggers once at a specific time. Use for reminders.
\`\`\`json
{"type": "one-shot", "channelId": "${channelIdForEvents}", "text": "Remind Mario about dentist", "at": "2025-12-15T09:00:00+01:00"}
\`\`\`

**Periodic** - Triggers on a cron schedule. Use for recurring tasks.
\`\`\`json
{"type": "periodic", "channelId": "${channelIdForEvents}", "text": "Check inbox and summarize", "schedule": "0 9 * * 1-5", "timezone": "${Intl.DateTimeFormat().resolvedOptions().timeZone}"}
\`\`\`

### Cron Format
\`minute hour day-of-month month day-of-week\`
- \`0 9 * * *\` = daily at 9:00
- \`0 9 * * 1-5\` = weekdays at 9:00
- \`30 14 * * 1\` = Mondays at 14:30
- \`0 0 1 * *\` = first of each month at midnight

### Timezones
All \`at\` timestamps must include offset (e.g., \`+01:00\`). Periodic events use IANA timezone names. The harness runs in ${Intl.DateTimeFormat().resolvedOptions().timeZone}. When users mention times without timezone, assume ${Intl.DateTimeFormat().resolvedOptions().timeZone}.

### Creating Events
Use unique filenames to avoid overwriting existing events. Include a timestamp or random suffix:
\`\`\`bash
cat > ${workspacePath}/events/dentist-reminder-$(date +%s).json << 'EOF'
{"type": "one-shot", "channelId": "${channelIdForEvents}", "text": "Dentist tomorrow", "at": "2025-12-14T09:00:00+01:00"}
EOF
\`\`\`
Or check if file exists first before creating.

### Managing Events
- List: \`ls ${workspacePath}/events/\`
- View: \`cat ${workspacePath}/events/foo.json\`
- Delete/cancel: \`rm ${workspacePath}/events/foo.json\`

### When Events Trigger
You receive a message like:
\`\`\`
[EVENT:dentist-reminder.json:one-shot:2025-12-14T09:00:00+01:00] Dentist tomorrow
\`\`\`
Immediate and one-shot events auto-delete after triggering. Periodic events persist until you delete them.

### Silent Completion
${silentGuide}

### Debouncing
When writing programs that create immediate events (email watchers, webhook handlers, etc.), always debounce. If 50 emails arrive in a minute, don't create 50 immediate events. Instead collect events over a window and create ONE immediate event summarizing what happened, or just signal "new activity, check inbox" rather than per-item events. Or simpler: use a periodic event to check for new items every N minutes instead of immediate events.

### Limits
Maximum 5 events can be queued. Don't create excessive immediate or periodic events.`
			: `## Events
Events are currently supported only when using the Slack transport in this repo. Do not create \`${workspacePath}/events/\` files from Discord sessions.`
	}

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
	- attach: ${toolAttachLabel}

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

// Cache runners per channel key (transport-aware)
const channelRunners = new Map<string, AgentRunner>();

/**
 * Get or create an AgentRunner for a channel.
 * Runners are cached - one per channel, persistent across messages.
 */
export function getOrCreateRunner(sandboxConfig: SandboxConfig, channelId: string, channelDir: string): AgentRunner {
	const runnerKey = `slack:${channelId}`;
	const existing = channelRunners.get(runnerKey);
	if (existing) return existing;

	const workingDir = resolve(channelDir, "..");
	const runner = createRunner(sandboxConfig, "slack", runnerKey, channelDir, workingDir);
	channelRunners.set(runnerKey, runner);
	return runner;
}

export function getOrCreateRunnerForTransport(
	sandboxConfig: SandboxConfig,
	transport: TransportName,
	runnerKey: string,
	channelDir: string,
	workingDir: string,
): AgentRunner {
	const existing = channelRunners.get(runnerKey);
	if (existing) return existing;
	const runner = createRunner(sandboxConfig, transport, runnerKey, channelDir, workingDir);
	channelRunners.set(runnerKey, runner);
	return runner;
}

/**
 * Create a new AgentRunner for a channel.
 * Sets up the session and subscribes to events once.
 */
function createRunner(
	sandboxConfig: SandboxConfig,
	transport: TransportName,
	runnerKey: string,
	channelDir: string,
	workingDir: string,
): AgentRunner {
	const executor = createExecutor(sandboxConfig);
	const workspacePath = executor.getWorkspacePath(workingDir);
	const channelRelPath = relative(workingDir, channelDir).replaceAll("\\", "/");

	// Mutable per-run state - referenced by the event handler and attach tool
	const runState = {
		ctx: null as TransportContext | null,
		logCtx: null as { channelId: string; userName?: string; channelName?: string; guildName?: string } | null,
		queue: null as {
			enqueue(fn: () => Promise<void>, errorContext: string): void;
			enqueueMessage(text: string, target: "primary" | "secondary", errorContext: string, doLog?: boolean): void;
		} | null,
		pendingTools: new Map<string, { toolName: string; args: unknown; startTime: number }>(),
		totalUsage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		errorMessage: undefined as string | undefined,
	};

	// Tools are created once per runner; the attach tool resolves the upload function per-run via runState.ctx.
	if (!existsSync(workingDir)) {
		mkdirSync(workingDir, { recursive: true });
	}
	const workingDirStats = statSync(workingDir);
	if (!workingDirStats.isDirectory()) {
		throw new Error(`workingDir is not a directory: ${workingDir}`);
	}
	const realWorkspaceRoot = realpathSync(workingDir);
	const tools = createMomTools(executor, () => {
		const ctx = runState.ctx;
		if (!ctx) return null;
		return async (filePath: string, title?: string) => {
			const hostPath = translateToHostPath(filePath, workingDir, channelDir, workspacePath, channelRelPath);
			const resolvedHostPath = resolve(hostPath);
			let realFilePath: string;
			try {
				realFilePath = realpathSync(resolvedHostPath);
			} catch {
				throw new Error("File does not exist");
			}
			try {
				const stats = statSync(realFilePath);
				if (!stats.isFile()) {
					throw new Error("Path is not a file");
				}
			} catch (err) {
				if (err instanceof Error) {
					throw err;
				}
				throw new Error("Path is not a file");
			}

			const relToWorkspace = relative(realWorkspaceRoot, realFilePath);
			// Ensure attachments can only come from within the configured working directory (workspace root),
			// even if the file path goes through symlinks.
			const relNormalized = relToWorkspace.replaceAll("\\", "/");
			const isOutside = isAbsolute(relToWorkspace) || relNormalized === ".." || relNormalized.startsWith("../");
			if (relNormalized === "" || !isOutside) {
				await ctx.uploadFile(realFilePath, title);
				return;
			}

			throw new Error("Can only attach files within the workspace directory");
		};
	});

	// Initial system prompt (will be updated each run with fresh memory/channels/users/skills)
	const memory = getMemory(workingDir, channelDir);
	const skills = loadMomSkills(workingDir, channelDir, workspacePath);
	const systemPrompt = buildSystemPrompt(
		workspacePath,
		channelRelPath,
		memory,
		sandboxConfig,
		[],
		[],
		skills,
		transport,
	);

	// Create session manager and settings manager
	// Pass model info so new sessions get a header written immediately
	const sessionManager = new MomSessionManager(channelDir, {
		provider: model.provider,
		id: model.id,
		thinkingLevel: "off",
	});
	const settingsManager = new MomSettingsManager(workingDir);

	// Create agent
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

	// Load existing messages
	const loadedSession = sessionManager.loadSession();
	if (loadedSession.messages.length > 0) {
		agent.replaceMessages(loadedSession.messages);
		log.logInfo(`[${runnerKey}] Loaded ${loadedSession.messages.length} messages from context.jsonl`);
	}

	// Create AgentSession wrapper
	const session = new AgentSession({
		agent,
		sessionManager: sessionManager as any,
		settingsManager: settingsManager as any,
	});

	// Subscribe to events ONCE
	session.subscribe(async (event) => {
		if (!runState.ctx || !runState.logCtx || !runState.queue) return;

		const ctx = runState.ctx;
		const logCtx = runState.logCtx;
		const queue = runState.queue;
		const pendingTools = runState.pendingTools;

		switch (event.type) {
			case "tool_execution_start": {
				const agentEvent = event as AgentEvent & { type: "tool_execution_start" };
				const args = agentEvent.args as { label?: string };
				const label = args.label || agentEvent.toolName;

				pendingTools.set(agentEvent.toolCallId, {
					toolName: agentEvent.toolName,
					args: agentEvent.args,
					startTime: Date.now(),
				});

				log.logToolStart(logCtx, agentEvent.toolName, label, agentEvent.args as Record<string, unknown>);
				queue.enqueue(() => ctx.send("primary", ctx.formatting.italic(`→ ${label}`), { log: false }), "tool label");
				break;
			}
			case "tool_execution_end": {
				const agentEvent = event as AgentEvent & { type: "tool_execution_end" };
				const resultStr = extractToolResultText(agentEvent.result);
				const pending = pendingTools.get(agentEvent.toolCallId);
				pendingTools.delete(agentEvent.toolCallId);

				const durationMs = pending ? Date.now() - pending.startTime : 0;
				const durationSecs = (durationMs / 1000).toFixed(1);

				if (agentEvent.isError) {
					log.logToolError(logCtx, agentEvent.toolName, durationMs, resultStr);
				} else {
					log.logToolSuccess(logCtx, agentEvent.toolName, durationMs, resultStr);
				}

				const label = pending?.args ? (pending.args as { label?: string }).label : undefined;
				const argsFormatted = pending
					? formatToolArgsForSlack(agentEvent.toolName, pending.args as Record<string, unknown>)
					: "";

				const payload: ToolResultData = {
					toolName: agentEvent.toolName,
					label,
					args: argsFormatted,
					result: resultStr,
					isError: agentEvent.isError,
					durationSecs,
				};

				if (ctx.sendToolResult) {
					queue.enqueue(() => ctx.sendToolResult!(payload), "tool result");
				} else {
					let msg = `${ctx.formatting.bold(`${agentEvent.isError ? "✗" : "✓"} ${agentEvent.toolName}`)}`;
					if (label) msg += `: ${label}`;
					msg += ` (${durationSecs}s)\n`;
					if (argsFormatted.trim()) msg += ctx.formatting.codeBlock(argsFormatted) + "\n";
					msg += `${ctx.formatting.bold("Result:")}\n${ctx.formatting.codeBlock(resultStr)}`;
					queue.enqueueMessage(msg, "secondary", "tool result", false);
				}

				if (agentEvent.isError) {
					queue.enqueue(
						() =>
							ctx.send("primary", ctx.formatting.italic(`Error: ${truncate(resultStr, 200)}`), { log: false }),
						"tool error",
					);
				}
				break;
			}
			case "message_start": {
				const agentEvent = event as AgentEvent & { type: "message_start" };
				if (agentEvent.message.role === "assistant") {
					log.logResponseStart(logCtx);
				}
				break;
			}
			case "message_end": {
				const agentEvent = event as AgentEvent & { type: "message_end" };
				if (agentEvent.message.role !== "assistant") break;

				const assistantMsg = agentEvent.message as any;

				if (assistantMsg.stopReason) {
					runState.stopReason = assistantMsg.stopReason;
				}
				if (assistantMsg.errorMessage) {
					runState.errorMessage = assistantMsg.errorMessage;
				}

				if (assistantMsg.usage) {
					runState.totalUsage.input += assistantMsg.usage.input;
					runState.totalUsage.output += assistantMsg.usage.output;
					runState.totalUsage.cacheRead += assistantMsg.usage.cacheRead;
					runState.totalUsage.cacheWrite += assistantMsg.usage.cacheWrite;
					runState.totalUsage.cost.input += assistantMsg.usage.cost.input;
					runState.totalUsage.cost.output += assistantMsg.usage.cost.output;
					runState.totalUsage.cost.cacheRead += assistantMsg.usage.cost.cacheRead;
					runState.totalUsage.cost.cacheWrite += assistantMsg.usage.cost.cacheWrite;
					runState.totalUsage.cost.total += assistantMsg.usage.cost.total;
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

				for (const thinking of thinkingParts) {
					log.logThinking(logCtx, thinking);
					queue.enqueueMessage(ctx.formatting.italic(thinking), "primary", "thinking primary");
					if (ctx.transport === "slack") {
						queue.enqueueMessage(ctx.formatting.italic(thinking), "secondary", "thinking secondary", false);
					}
				}

				const text = textParts.join("\n");
				if (text.trim()) {
					log.logResponse(logCtx, text);
					queue.enqueueMessage(text, "primary", "response primary");
					// Slack uses threads for verbose output; Discord doesn't need secondary text (only tool embeds)
					if (ctx.transport === "slack") {
						queue.enqueueMessage(text, "secondary", "response secondary", false);
					}
				}
				break;
			}
			case "auto_compaction_start": {
				log.logInfo(`Auto-compaction started (reason: ${(event as any).reason})`);
				queue.enqueue(
					() => ctx.send("primary", ctx.formatting.italic("Compacting context..."), { log: false }),
					"compaction start",
				);
				break;
			}
			case "auto_compaction_end": {
				const compEvent = event as any;
				if (compEvent.result) {
					log.logInfo(`Auto-compaction complete: ${compEvent.result.tokensBefore} tokens compacted`);
				} else if (compEvent.aborted) {
					log.logInfo("Auto-compaction aborted");
				}
				break;
			}
			case "auto_retry_start": {
				const retryEvent = event as any;
				log.logWarning(`Retrying (${retryEvent.attempt}/${retryEvent.maxAttempts})`, retryEvent.errorMessage);
				queue.enqueue(
					() =>
						ctx.send(
							"primary",
							ctx.formatting.italic(`Retrying (${retryEvent.attempt}/${retryEvent.maxAttempts})...`),
							{ log: false },
						),
					"retry",
				);
				break;
			}
			default:
				break;
		}
	});

	return {
		async run(
			ctx: TransportContext,
			_pendingMessages?: PendingMessage[],
		): Promise<{ stopReason: string; errorMessage?: string }> {
			// Ensure channel directory exists
			await mkdir(channelDir, { recursive: true });

			// Sync log.jsonl → context.jsonl before reloading messages.
			// Slack has a pre-run sync in `main.ts` that excludes "future" messages by ts.
			// Discord currently relies on this sync to get channel chatter into context.
			if (transport === "discord") {
				try {
					syncLogToContext(channelDir, { mode: "discord", excludeTs: ctx.message.messageId });
				} catch (error) {
					log.logWarning("Failed to sync log to context", error instanceof Error ? error.message : String(error));
				}
			}

			// Reload messages from context.jsonl
			// This picks up any messages synced from log.jsonl before this run
			const reloadedSession = sessionManager.loadSession();
			if (reloadedSession.messages.length > 0) {
				agent.replaceMessages(reloadedSession.messages);
				log.logInfo(`[${runnerKey}] Reloaded ${reloadedSession.messages.length} messages from context`);
			}

			// Update system prompt with fresh memory, channel/user info, and skills
			const memory = getMemory(workingDir, channelDir);
			const skills = loadMomSkills(workingDir, channelDir, workspacePath);
			const systemPrompt = buildSystemPrompt(
				workspacePath,
				channelRelPath,
				memory,
				sandboxConfig,
				ctx.channels,
				ctx.users,
				skills,
				transport,
			);
			session.agent.setSystemPrompt(systemPrompt);

			// Reset per-run state
			runState.ctx = ctx;
			runState.logCtx = {
				channelId: ctx.message.channelId,
				userName: ctx.message.userName,
				channelName: ctx.channelName,
			};
			runState.pendingTools.clear();
			runState.totalUsage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			runState.stopReason = "stop";
			runState.errorMessage = undefined;

			let wasSilent = false;

			// Create queue for this run
			let queueChain = Promise.resolve();
			runState.queue = {
				enqueue(fn: () => Promise<void>, errorContext: string): void {
					queueChain = queueChain.then(async () => {
						try {
							await fn();
						} catch (err) {
							const errMsg = err instanceof Error ? err.message : String(err);
							log.logWarning(`Transport API error (${errorContext})`, errMsg);
							// If the run ended with [SILENT], avoid creating new messages as a side effect of
							// cleanup/transport errors (e.g., stop-control removal on a deleted message).
							if (wasSilent) return;
							try {
								await ctx.send("secondary", ctx.formatting.italic(`Error: ${errMsg}`), { log: false });
							} catch {
								// Ignore
							}
						}
					});
				},
				enqueueMessage(text: string, target: "primary" | "secondary", errorContext: string, doLog = true): void {
					this.enqueue(() => ctx.send(target, text, { log: doLog }), errorContext);
				},
			};

			let result: { stopReason: string; errorMessage?: string } | null = null;

			try {
				// Log context info
				log.logInfo(`Context sizes - system: ${systemPrompt.length} chars, memory: ${memory.length} chars`);
				log.logInfo(`Channels: ${ctx.channels.length}, Users: ${ctx.users.length}`);

				// Optional per-transport stop controls (e.g., Discord button)
				if (ctx.addStopControl) {
					runState.queue.enqueue(() => ctx.addStopControl!(), "stop control add");
					await queueChain;
				}

				// Build user message with timestamp and username prefix
				// Format: "[YYYY-MM-DD HH:MM:SS+HH:MM] [username]: message" so LLM knows when and who
				const now = new Date();
				const pad = (n: number) => n.toString().padStart(2, "0");
				const offset = -now.getTimezoneOffset();
				const offsetSign = offset >= 0 ? "+" : "-";
				const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
				const offsetMins = pad(Math.abs(offset) % 60);
				const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offsetSign}${offsetHours}:${offsetMins}`;
				let userMessage = `[${timestamp}] [${ctx.message.userName || "unknown"}]: ${ctx.message.text}`;

				// Add attachment paths if any (convert to absolute paths in execution environment)
				if (ctx.message.attachments && ctx.message.attachments.length > 0) {
					const attachmentPaths = ctx.message.attachments.map((a) => `${workspacePath}/${a.local}`).join("\n");
					userMessage += `\n\n<attachments>\n${attachmentPaths}\n</attachments>`;
				}

				// Debug: write context to last_prompt.jsonl
				const debugContext = {
					systemPrompt,
					messages: session.messages,
					newUserMessage: userMessage,
				};
				await writeFile(join(channelDir, "last_prompt.jsonl"), JSON.stringify(debugContext, null, 2));

				await session.prompt(userMessage);

				// Wait for queued messages
				await queueChain;

				// Handle error case - update main message and post error to thread
				if (runState.stopReason === "error" && runState.errorMessage) {
					try {
						await ctx.replacePrimary(ctx.formatting.italic("Sorry, something went wrong"));
						await ctx.send("secondary", ctx.formatting.italic(`Error: ${runState.errorMessage}`), { log: false });
					} catch (err) {
						const errMsg = err instanceof Error ? err.message : String(err);
						log.logWarning("Failed to post error message", errMsg);
					}
				} else {
					// Final message update
					const messages = session.messages;
					const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
					const finalText =
						lastAssistant?.content
							.filter((c): c is { type: "text"; text: string } => c.type === "text")
							.map((c) => c.text)
							.join("\n") || "";

					// Check for [SILENT] marker - delete message and thread instead of posting
					if (finalText.trim() === "[SILENT]" || finalText.trim().startsWith("[SILENT]")) {
						try {
							await ctx.deletePrimaryAndSecondary();
							wasSilent = true;
							log.logInfo("Silent response - deleted message and thread");
						} catch (err) {
							const errMsg = err instanceof Error ? err.message : String(err);
							log.logWarning("Failed to delete message for silent response", errMsg);
						}
					} else if (finalText.trim()) {
						try {
							await ctx.replacePrimary(finalText);
						} catch (err) {
							const errMsg = err instanceof Error ? err.message : String(err);
							log.logWarning("Failed to replace message with final text", errMsg);
						}
					}
				}

				// Log usage summary with context info
				if (!wasSilent && runState.totalUsage.cost.total > 0) {
					// Get last non-aborted assistant message for context calculation
					const messages = session.messages;
					const lastAssistantMessage = messages
						.slice()
						.reverse()
						.find((m) => m.role === "assistant" && (m as any).stopReason !== "aborted") as any;

					const contextTokens = lastAssistantMessage
						? lastAssistantMessage.usage.input +
							lastAssistantMessage.usage.output +
							lastAssistantMessage.usage.cacheRead +
							lastAssistantMessage.usage.cacheWrite
						: 0;
					const contextWindow = model.contextWindow || 200000;

					const summary = log.logUsageSummary(runState.logCtx!, runState.totalUsage, contextTokens, contextWindow);
					if (ctx.sendUsageSummary) {
						const contextPercent = ((contextTokens / contextWindow) * 100).toFixed(1) + "%";
						runState.queue.enqueue(
							() =>
								ctx.sendUsageSummary!({
									tokens: { input: runState.totalUsage.input, output: runState.totalUsage.output },
									cache: { read: runState.totalUsage.cacheRead, write: runState.totalUsage.cacheWrite },
									context: { used: contextTokens, max: contextWindow, percent: contextPercent },
									cost: runState.totalUsage.cost,
								}),
							"usage summary",
						);
					} else {
						runState.queue.enqueue(() => ctx.send("secondary", summary, { log: false }), "usage summary");
					}
					await queueChain;
				}

				result = { stopReason: runState.stopReason, errorMessage: runState.errorMessage };
				return result;
			} finally {
				// Remove stop controls after completion (best-effort)
				if (ctx.removeStopControl && runState.queue) {
					runState.queue.enqueue(() => ctx.removeStopControl!(), "stop control remove");
					try {
						await queueChain;
					} catch {
						// ignore
					}
				}

				// Clear run state
				runState.ctx = null;
				runState.logCtx = null;
				runState.queue = null;
			}
		},

		abort(): void {
			session.abort();
		},
	};
}

/**
 * Translate container path back to host path for file operations
 */
function translateToHostPath(
	containerPath: string,
	workingDir: string,
	channelDir: string,
	workspacePath: string,
	channelRelPath: string,
): string {
	const normalizedWorkspacePath = workspacePath.replaceAll("\\", "/").replace(/\/$/, "");
	const normalizedContainerPath = containerPath.replaceAll("\\", "/");
	const normalizedChannelRelPath = channelRelPath.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/$/, "");

	const channelPrefix = `${normalizedWorkspacePath}/${normalizedChannelRelPath}/`;
	if (normalizedContainerPath.startsWith(channelPrefix)) {
		return join(channelDir, normalizedContainerPath.slice(channelPrefix.length));
	}

	const workspacePrefix = `${normalizedWorkspacePath}/`;
	if (normalizedContainerPath.startsWith(workspacePrefix)) {
		return join(workingDir, normalizedContainerPath.slice(workspacePrefix.length));
	}

	return containerPath;
}
