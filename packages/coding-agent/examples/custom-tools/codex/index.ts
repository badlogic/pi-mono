/**
 * Codex Tool - Use OpenAI Codex as a sub-agent
 *
 * Spawns a Codex session via the Codex SDK, streaming events in real-time.
 * Re-uses authentication from the codex CLI (~/.codex/auth.json).
 *
 * Useful for tasks like code review (/review), where Codex can be invoked
 * as a specialized sub-agent with its own context window.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import { type CustomAgentTool, type CustomToolFactory, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import {
	Codex,
	type CommandExecutionItem,
	type ErrorItem,
	type FileChangeItem,
	type ReasoningItem,
	type ThreadEvent,
	type ThreadItem,
	type Usage,
} from "@openai/codex-sdk";
import { Type } from "@sinclair/typebox";

const CODEX_AUTH_PATH = path.join(os.homedir(), ".codex", "auth.json");
const CODEX_CONFIG_PATH = path.join(os.homedir(), ".codex", "config.toml");

interface CodexAuth {
	OPENAI_API_KEY?: string | null;
	tokens?: {
		access_token?: string;
		refresh_token?: string;
	};
}

interface CodexToolDetails {
	threadId: string | null;
	items: ThreadItem[];
	usage: Usage | null;
	model: string | null;
	finalResponse: string;
	error?: string;
	status: "running" | "completed" | "failed";
	prompt: string;
	startTime: number;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatElapsed(startTime: number): string {
	const elapsed = Math.floor((Date.now() - startTime) / 1000);
	if (elapsed < 60) return `${elapsed}s`;
	const mins = Math.floor(elapsed / 60);
	const secs = elapsed % 60;
	if (mins < 60) return `${mins}m${secs}s`;
	const hours = Math.floor(mins / 60);
	const remainingMins = mins % 60;
	return `${hours}h${remainingMins}m`;
}

function formatUsage(usage: Usage | null, model: string | null): string {
	if (!usage) return "";
	const parts: string[] = [];
	if (usage.input_tokens) parts.push(`↑${formatTokens(usage.input_tokens)}`);
	if (usage.cached_input_tokens) parts.push(`cache:${formatTokens(usage.cached_input_tokens)}`);
	if (usage.output_tokens) parts.push(`↓${formatTokens(usage.output_tokens)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

function hasCodexAuth(): boolean {
	try {
		if (!fs.existsSync(CODEX_AUTH_PATH)) {
			return false;
		}
		const authData: CodexAuth = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, "utf-8"));

		// Check for explicit API key or OAuth tokens
		return !!(authData.OPENAI_API_KEY || authData.tokens?.access_token);
	} catch {
		return false;
	}
}

function getDefaultModel(): string | undefined {
	try {
		if (!fs.existsSync(CODEX_CONFIG_PATH)) {
			return undefined;
		}
		const content = fs.readFileSync(CODEX_CONFIG_PATH, "utf-8");
		// Simple TOML parsing for model = "..."
		const match = content.match(/^model\s*=\s*"([^"]+)"/m);
		return match?.[1];
	} catch {
		return undefined;
	}
}

const SandboxModeSchema = StringEnum(["read-only", "workspace-write", "danger-full-access"] as const, {
	description: 'Sandbox mode for file access. Default: "danger-full-access" for maximum capability.',
	default: "danger-full-access",
});

const ReasoningEffortSchema = StringEnum(["minimal", "low", "medium", "high", "xhigh"] as const, {
	description: "Reasoning effort level for the model.",
});

const CodexParams = Type.Object({
	prompt: Type.String({ description: "The prompt or task to send to Codex" }),
	model: Type.Optional(Type.String({ description: "Model to use (default: from codex config or gpt-4.1)" })),
	sandboxMode: Type.Optional(SandboxModeSchema),
	reasoningEffort: Type.Optional(ReasoningEffortSchema),
	cwd: Type.Optional(Type.String({ description: "Working directory for Codex (default: current directory)" })),
	skipGitCheck: Type.Optional(
		Type.Boolean({ description: "Skip Git repository check. Default: true.", default: true }),
	),
	networkAccess: Type.Optional(
		Type.Boolean({ description: "Enable network access for Codex. Default: true.", default: true }),
	),
	webSearch: Type.Optional(
		Type.Boolean({ description: "Enable web search for Codex. Default: false.", default: false }),
	),
});

type CodexParamsType = {
	prompt: string;
	model?: string;
	sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
	cwd?: string;
	skipGitCheck?: boolean;
	networkAccess?: boolean;
	webSearch?: boolean;
};

const factory: CustomToolFactory = (pi) => {
	const tool: CustomAgentTool<typeof CodexParams, CodexToolDetails> = {
		name: "codex",
		label: "Codex",
		description: [
			"Invoke OpenAI Codex as a sub-agent with its own context window.",
			"Useful for delegating tasks like code review, refactoring, or complex analysis.",
			"Uses authentication from the codex CLI (~/.codex/auth.json).",
			"By default runs with full access and no approvals for maximum capability.",
		].join(" "),
		parameters: CodexParams,

		async execute(_toolCallId, rawParams, signal, onUpdate) {
			const params = rawParams as CodexParamsType;
			const startTime = Date.now();

			if (!hasCodexAuth()) {
				return {
					content: [
						{
							type: "text",
							text: "No Codex authentication found. Run `codex login` to authenticate.",
						},
					],
					details: {
						threadId: null,
						items: [],
						usage: null,
						model: null,
						finalResponse: "",
						error: "Not authenticated",
						status: "failed",
						prompt: params.prompt,
						startTime,
					},
					isError: true,
				};
			}

			const currentDetails: CodexToolDetails = {
				threadId: null,
				items: [],
				usage: null,
				model: params.model || getDefaultModel() || null,
				finalResponse: "",
				status: "running",
				prompt: params.prompt,
				startTime,
			};

			const emitUpdate = () => {
				onUpdate?.({
					content: [{ type: "text", text: currentDetails.finalResponse || "(running...)" }],
					details: { ...currentDetails },
				});
			};

			// Emit immediately so the UI shows progress from the start
			emitUpdate();

			// Set up a periodic timer to refresh elapsed time display
			const refreshInterval = setInterval(() => {
				if (currentDetails.status === "running") {
					emitUpdate();
				}
			}, 1000);

			// Track the events generator for cleanup
			let events: AsyncGenerator<ThreadEvent> | null = null;

			try {
				// Don't pass apiKey - let the codex CLI use its own auth from ~/.codex/auth.json
				// The SDK spawns the CLI as a subprocess, which handles OAuth tokens properly
				const codex = new Codex({});

				const thread = codex.startThread({
					model: params.model || getDefaultModel(),
					// Default to full access with no approvals (like codex --dangerously-bypass-approvals-and-sandbox)
					sandboxMode: params.sandboxMode || "danger-full-access",
					workingDirectory: params.cwd || pi.cwd,
					skipGitRepoCheck: params.skipGitCheck ?? true,
					modelReasoningEffort: params.reasoningEffort,
					networkAccessEnabled: params.networkAccess ?? true,
					webSearchEnabled: params.webSearch,
					approvalPolicy: "never",
				});

				const streamResult = await thread.runStreamed(params.prompt, { signal });
				events = streamResult.events;

				// Process events until turn completes or fails
				eventLoop: for await (const event of events) {
					if (signal?.aborted) {
						currentDetails.status = "failed";
						currentDetails.error = "Aborted";
						break;
					}

					switch (event.type) {
						case "thread.started":
							currentDetails.threadId = event.thread_id;
							emitUpdate();
							break;

						case "item.started":
						case "item.updated":
							// Update or add item
							{
								const idx = currentDetails.items.findIndex((i) => i.id === event.item.id);
								if (idx >= 0) {
									currentDetails.items[idx] = event.item;
								} else {
									currentDetails.items.push(event.item);
								}

								// Update final response if it's an agent message
								if (event.item.type === "agent_message") {
									currentDetails.finalResponse = event.item.text;
								}
								emitUpdate();
							}
							break;

						case "item.completed":
							{
								const idx = currentDetails.items.findIndex((i) => i.id === event.item.id);
								if (idx >= 0) {
									currentDetails.items[idx] = event.item;
								} else {
									currentDetails.items.push(event.item);
								}
								if (event.item.type === "agent_message") {
									currentDetails.finalResponse = event.item.text;
								}
								emitUpdate();
							}
							break;

						case "turn.completed":
							currentDetails.usage = event.usage;
							currentDetails.status = "completed";
							emitUpdate();
							// Turn is done - exit the event loop immediately
							// Don't wait for the generator to naturally close (may hang waiting for process exit)
							break eventLoop;

						case "turn.failed":
							currentDetails.error = event.error.message;
							currentDetails.status = "failed";
							emitUpdate();
							// Turn is done - exit the event loop immediately
							break eventLoop;

						case "error":
							// Error events can be informational (e.g., "Reconnecting...")
							// Don't treat them as fatal unless turn.failed follows
							currentDetails.error = event.message;
							emitUpdate();
							break;
					}
				}

				// If loop ended without explicit completion/failure, check if we have a response
				if (currentDetails.status === "running") {
					if (currentDetails.finalResponse) {
						currentDetails.status = "completed";
					} else {
						currentDetails.status = "failed";
						currentDetails.error = currentDetails.error || "Session ended unexpectedly";
					}
				}

				if (currentDetails.status === "failed") {
					return {
						content: [
							{
								type: "text",
								text: `Codex failed: ${currentDetails.error || "Unknown error"}\n\n${currentDetails.finalResponse}`,
							},
						],
						details: currentDetails,
						isError: true,
					};
				}

				return {
					content: [{ type: "text", text: currentDetails.finalResponse || "(no output)" }],
					details: currentDetails,
				};
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				currentDetails.status = "failed";
				currentDetails.error = errorMessage;

				// If we have a partial response, include it
				const responseText = currentDetails.finalResponse
					? `Codex error: ${errorMessage}\n\nPartial response:\n${currentDetails.finalResponse}`
					: `Codex error: ${errorMessage}`;

				return {
					content: [{ type: "text", text: responseText }],
					details: currentDetails,
					isError: true,
				};
			} finally {
				// Always clean up resources
				clearInterval(refreshInterval);

				// Close the async generator to ensure the underlying CLI process is terminated.
				// This is important when we break out of the loop early (on turn.completed/turn.failed/abort).
				if (events?.return) {
					try {
						await events.return(undefined);
					} catch {
						// Ignore errors during cleanup
					}
				}
			}
		},

		renderCall(args, theme) {
			const model = args.model || getDefaultModel() || "default";
			const sandbox = args.sandboxMode || "read-only";
			const promptPreview =
				args.prompt && args.prompt.length > 80 ? `${args.prompt.slice(0, 80)}...` : args.prompt || "...";

			let text =
				theme.fg("toolTitle", theme.bold("codex ")) +
				theme.fg("accent", model) +
				theme.fg("muted", ` [${sandbox}]`);
			text += `\n  ${theme.fg("dim", promptPreview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const { details } = result;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();
			const isError = details.status === "failed";
			const isRunning = details.status === "running";
			const icon = isError
				? theme.fg("error", "✗")
				: isRunning
					? theme.fg("warning", "⏳")
					: theme.fg("success", "✓");

			// Collect items by type for display
			const commands = details.items.filter((i): i is CommandExecutionItem => i.type === "command_execution");
			const fileChanges = details.items.filter((i): i is FileChangeItem => i.type === "file_change");
			const reasoning = details.items.filter((i): i is ReasoningItem => i.type === "reasoning");
			const errors = details.items.filter((i): i is ErrorItem => i.type === "error");

			if (expanded) {
				const container = new Container();

				// Header with elapsed time
				let header = `${icon} ${theme.fg("toolTitle", theme.bold("codex"))}`;
				if (details.model) header += ` ${theme.fg("accent", details.model)}`;
				header += ` ${theme.fg("dim", `(${formatElapsed(details.startTime)})`)}`;
				if (details.threadId) header += ` ${theme.fg("dim", `[${details.threadId.slice(0, 8)}...]`)}`;
				container.addChild(new Text(header, 0, 0));

				// Show the prompt
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("muted", "─── Prompt ───"), 0, 0));
				container.addChild(new Text(theme.fg("toolOutput", details.prompt), 0, 0));

				// Error message
				if (details.error) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("error", `Error: ${details.error}`), 0, 0));
				}

				// Show reasoning if any
				if (reasoning.length > 0) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Reasoning ───"), 0, 0));
					for (const r of reasoning) {
						container.addChild(new Text(theme.fg("dim", r.text), 0, 0));
					}
				}

				// Show commands
				if (commands.length > 0) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Commands ───"), 0, 0));
					for (const cmd of commands) {
						const cmdIcon =
							cmd.status === "completed"
								? theme.fg("success", "✓")
								: cmd.status === "failed"
									? theme.fg("error", "✗")
									: theme.fg("warning", "⏳");
						container.addChild(
							new Text(`${cmdIcon} ${theme.fg("muted", "$ ")}${theme.fg("toolOutput", cmd.command)}`, 0, 0),
						);
						if (cmd.aggregated_output && expanded) {
							const outputLines = cmd.aggregated_output.split("\n").slice(0, 10);
							for (const line of outputLines) {
								container.addChild(new Text(theme.fg("dim", `  ${line}`), 0, 0));
							}
							if (cmd.aggregated_output.split("\n").length > 10) {
								container.addChild(new Text(theme.fg("muted", "  ... (truncated)"), 0, 0));
							}
						}
					}
				}

				// Show file changes
				if (fileChanges.length > 0) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── File Changes ───"), 0, 0));
					for (const fc of fileChanges) {
						for (const change of fc.changes) {
							const kindColor =
								change.kind === "add" ? "success" : change.kind === "delete" ? "error" : "warning";
							container.addChild(
								new Text(
									`${theme.fg(kindColor, change.kind.toUpperCase())} ${theme.fg("accent", change.path)}`,
									0,
									0,
								),
							);
						}
					}
				}

				// Show errors from items
				if (errors.length > 0) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Errors ───"), 0, 0));
					for (const e of errors) {
						container.addChild(new Text(theme.fg("error", e.message), 0, 0));
					}
				}

				// Final response as markdown
				if (details.finalResponse) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Response ───"), 0, 0));
					container.addChild(new Markdown(details.finalResponse.trim(), 0, 0, mdTheme));
				}

				// Usage stats
				const usageStr = formatUsage(details.usage, details.model);
				if (usageStr) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
				}

				return container;
			}

			// Collapsed view
			let text = `${icon} ${theme.fg("toolTitle", theme.bold("codex"))}`;
			if (details.model) text += ` ${theme.fg("accent", details.model)}`;
			text += ` ${theme.fg("dim", `(${formatElapsed(details.startTime)})`)}`;

			// Show summary of activity
			const activity: string[] = [];
			if (commands.length > 0) activity.push(`${commands.length} cmd${commands.length > 1 ? "s" : ""}`);
			if (fileChanges.length > 0) {
				const totalChanges = fileChanges.reduce((acc, fc) => acc + fc.changes.length, 0);
				activity.push(`${totalChanges} file${totalChanges > 1 ? "s" : ""}`);
			}
			if (activity.length > 0) {
				text += ` ${theme.fg("dim", `[${activity.join(", ")}]`)}`;
			}

			// Show prompt preview (truncated)
			const promptPreview = details.prompt.length > 80 ? `${details.prompt.slice(0, 80)}...` : details.prompt;
			text += `\n${theme.fg("toolOutput", promptPreview)}`;

			if (details.error) {
				text += `\n${theme.fg("error", `Error: ${details.error}`)}`;
			}

			// Show activity: commands or reasoning status
			if (commands.length > 0) {
				const completedCmds = commands.filter((c) => c.status !== "in_progress");
				const runningCmd = commands.find((c) => c.status === "in_progress");

				// Show last 3 completed commands
				const recentCompleted = completedCmds.slice(-3);
				for (const cmd of recentCompleted) {
					const cmdIcon = cmd.status === "completed" ? theme.fg("success", "✓") : theme.fg("error", "✗");
					const cmdText = cmd.command.length > 60 ? `${cmd.command.slice(0, 60)}...` : cmd.command;
					text += `\n${cmdIcon} ${theme.fg("dim", cmdText)}`;
				}

				// Show current running command
				if (runningCmd) {
					const cmdText =
						runningCmd.command.length > 60 ? `${runningCmd.command.slice(0, 60)}...` : runningCmd.command;
					text += `\n${theme.fg("warning", "⏳")} ${theme.fg("toolOutput", cmdText)}`;
				}
			} else if (isRunning) {
				// No commands yet - show what's happening
				if (reasoning.length > 0) {
					// Show that reasoning is in progress with a preview
					const lastReasoning = reasoning[reasoning.length - 1];
					const reasoningPreview =
						lastReasoning.text.length > 60 ? `${lastReasoning.text.slice(0, 60)}...` : lastReasoning.text;
					text += `\n${theme.fg("warning", "⏳")} ${theme.fg("muted", "thinking:")} ${theme.fg("dim", reasoningPreview)}`;
				} else if (details.threadId) {
					text += `\n${theme.fg("warning", "⏳")} ${theme.fg("muted", "thinking...")}`;
				} else {
					text += `\n${theme.fg("warning", "⏳")} ${theme.fg("muted", "starting...")}`;
				}
			}

			// Show preview of final response only when completed
			if (!isRunning && details.finalResponse) {
				const preview =
					details.finalResponse.length > 200 ? `${details.finalResponse.slice(0, 200)}...` : details.finalResponse;
				text += `\n${theme.fg("dim", preview.split("\n").slice(0, 3).join("\n"))}`;
			}

			// Usage stats
			const usageStr = formatUsage(details.usage, null);
			if (usageStr) {
				text += `\n${theme.fg("dim", usageStr)}`;
			}

			if (!expanded && details.items.length > 0) {
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
			}

			return new Text(text, 0, 0);
		},
	};

	return tool;
};

export default factory;
