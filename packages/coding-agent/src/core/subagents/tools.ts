/**
 * Tool registrations for subagents.
 *
 * @module subagents/tools
 */

import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "../extensions/types.js";
import type { SubagentManager } from "./manager.js";
import type { SubagentListDetails, SubagentSendDetails, SubagentStartDetails } from "./types.js";

/**
 * Register all subagent tools with the extension API.
 */
export function registerSubagentTools(pi: ExtensionAPI, manager: SubagentManager): void {
	// subagent_start - Start a new subagent (non-blocking)
	pi.registerTool({
		name: "subagent_start",
		label: "Start Subagent",
		description: [
			"Start a specialized subagent that runs in the background (non-blocking).",
			"Returns immediately with a subagent ID.",
			"Results are delivered to the main window when the subagent completes.",
			"Use subagent_wait to block until completion, or subagent_list to check status.",
			"Available agents: scout (fast recon), planner (implementation plans), worker (full capabilities).",
		].join(" "),
		parameters: Type.Object({
			agent: Type.String({
				description: "Agent name: 'scout' (fast recon), 'planner' (planning), 'worker' (general purpose)",
			}),
			task: Type.String({ description: "Task for the subagent to execute" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			try {
				// Always non-blocking - start subagent and return immediately
				const result = await manager.startSubagent(params.agent, params.task, {
					mode: "in-memory",
					waitForResult: false,
					cwd: ctx.cwd,
				});

				return {
					content: [
						{
							type: "text",
							text: `Started subagent '${params.agent}' with ID: ${result.id}\nStatus: ${result.status}\n\nThe subagent is running in the background. Results will appear when complete.\nUse subagent_list to check status, or subagent_wait to block until done.`,
						},
					],
					details: {
						subagentId: result.id,
						name: params.agent,
						status: result.status,
						mode: "in-memory",
					} satisfies SubagentStartDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Failed to start subagent: ${message}` }],
					details: {
						subagentId: "",
						name: params.agent,
						status: "error" as const,
						mode: "in-memory",
						error: message,
					} satisfies SubagentStartDetails,
				};
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("subagent_start ")) + theme.fg("accent", args.agent);
			const taskPreview = args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task;
			text += `\n  ${theme.fg("dim", taskPreview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as SubagentStartDetails | undefined;

			if (details?.error) {
				const text = result.content[0];
				return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
			}

			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "Started", 0, 0);
			}

			const icon = theme.fg("success", "▶");
			let text = `${icon} ${theme.fg("toolTitle", theme.bold(details.name))}`;
			text += theme.fg("muted", ` (${details.subagentId}, ${details.status})`);
			text += `\n  ${theme.fg("dim", "Running in background...")}`;
			return new Text(text, 0, 0);
		},
	});

	// subagent_wait - Wait for a subagent to complete
	pi.registerTool({
		name: "subagent_wait",
		label: "Wait for Subagent",
		description: "Wait for a subagent to complete and return its result. Blocks until the subagent finishes.",
		parameters: Type.Object({
			subagentId: Type.String({ description: "ID of the subagent to wait for" }),
			timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 300000 = 5 min)" })),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
			const timeout = params.timeout ?? 300000;

			try {
				// Subscribe to status updates for streaming
				const unsubscribe = manager.on((event) => {
					if (event.type === "status" && event.subagentId === params.subagentId) {
						const subagent = manager.getSubagent(params.subagentId);
						if (onUpdate && subagent) {
							onUpdate({
								content: [
									{
										type: "text",
										text: `Waiting for subagent '${subagent.name}'...\nStatus: ${event.status}`,
									},
								],
								details: {
									subagentId: params.subagentId,
									status: event.status,
								},
							});
						}
					}
				});

				// Check if subagent exists
				const subagent = manager.getSubagent(params.subagentId);
				if (!subagent) {
					unsubscribe();
					return {
						content: [{ type: "text", text: `Subagent ${params.subagentId} not found` }],
						details: {
							subagentId: params.subagentId,
							status: "error" as const,
							error: "Subagent not found",
						},
					};
				}

				// Wait for completion
				await manager.waitForCompletion(params.subagentId, timeout);
				unsubscribe();

				// Get final output
				const output = await manager.getSubagentOutput(params.subagentId);
				const finalSubagent = manager.getSubagent(params.subagentId);

				return {
					content: [{ type: "text", text: output.output ?? "(no output)" }],
					details: {
						subagentId: params.subagentId,
						name: finalSubagent?.name,
						status: output.status,
						output: output.output,
						usage: output.usage,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Failed to wait for subagent: ${message}` }],
					details: {
						subagentId: params.subagentId,
						status: "error" as const,
						error: message,
					},
				};
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("subagent_wait ")) + theme.fg("accent", args.subagentId);
			if (args.timeout) {
				text += theme.fg("muted", ` (${args.timeout}ms)`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as
				| { subagentId: string; status: string; error?: string; output?: string }
				| undefined;

			if (details?.error) {
				const text = result.content[0];
				return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
			}

			const icon = details?.status === "done" ? theme.fg("success", "✓") : theme.fg("warning", "⏳");
			let text = `${icon} ${theme.fg("toolTitle", theme.bold("subagent_wait"))}`;
			text += theme.fg("muted", ` (${details?.subagentId}, ${details?.status})`);

			if (details?.output) {
				const preview = details.output.slice(0, 200);
				text += `\n${theme.fg("dim", preview)}${details.output.length > 200 ? "..." : ""}`;
			}

			return new Text(text, 0, 0);
		},
	});

	// subagent_send - Send message to an alive subagent
	pi.registerTool({
		name: "subagent_send",
		label: "Send to Subagent",
		description:
			"Send a follow-up message to an alive subagent. Use when you need to provide additional context or request modifications.",
		parameters: Type.Object({
			subagentId: Type.String({ description: "ID of the alive subagent" }),
			message: Type.String({ description: "Message to send to the subagent" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				await manager.sendToSubagent(params.subagentId, params.message);

				const subagent = manager.getSubagent(params.subagentId);
				const output = subagent ? await manager.getSubagentOutput(params.subagentId) : null;

				return {
					content: [
						{
							type: "text",
							text: output?.output ?? "Message sent",
						},
					],
					details: {
						subagentId: params.subagentId,
						status: subagent?.status ?? "error",
						output: output?.output ?? "",
					} satisfies SubagentSendDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Failed to send message: ${message}` }],
					details: {
						subagentId: params.subagentId,
						status: "error",
						output: "",
						error: message,
					} satisfies SubagentSendDetails,
				};
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("subagent_send ")) + theme.fg("accent", args.subagentId);
			const msgPreview = args.message.length > 60 ? `${args.message.slice(0, 60)}...` : args.message;
			text += `\n  ${theme.fg("dim", msgPreview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as SubagentSendDetails | undefined;

			if (details?.error) {
				const text = result.content[0];
				return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "Sent", 0, 0);
		},
	});

	// subagent_list - List all alive subagents
	pi.registerTool({
		name: "subagent_list",
		label: "List Subagents",
		description: "List all alive subagents with their status, task, and usage. Use to check on running subagents.",
		parameters: Type.Object({}),

		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const agents = manager.listSubagents();

			if (agents.length === 0) {
				return {
					content: [{ type: "text", text: "No alive subagents." }],
					details: { agents: [] } satisfies SubagentListDetails,
				};
			}

			const lines = agents.map((a) => {
				const taskPreview = a.task.length > 40 ? `${a.task.slice(0, 40)}...` : a.task;
				return `${a.id}: ${a.name} - ${a.status} (turns: ${a.turnCount})\n  Task: ${taskPreview}`;
			});

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					agents: agents.map((a) => ({
						id: a.id,
						name: a.name,
						status: a.status,
						task: a.task,
						turnCount: a.turnCount,
						usage: a.usage,
					})),
				} satisfies SubagentListDetails,
			};
		},

		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("subagent_list")), 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as SubagentListDetails | undefined;

			if (!details || details.agents.length === 0) {
				return new Text(theme.fg("muted", "No alive subagents"), 0, 0);
			}

			let output = theme.fg("toolTitle", theme.bold(`Alive Subagents (${details.agents.length})`));
			for (const a of details.agents) {
				const icon =
					a.status === "running"
						? theme.fg("warning", "⏳")
						: a.status === "done"
							? theme.fg("success", "✓")
							: theme.fg("muted", "○");
				output += `\n  ${icon} ${theme.fg("accent", a.id)}: ${a.name} (${a.status})`;
			}
			return new Text(output, 0, 0);
		},
	});

	// subagent_stop - Stop an alive subagent
	pi.registerTool({
		name: "subagent_stop",
		label: "Stop Subagent",
		description: "Stop an alive subagent and free its resources. Use when a subagent is no longer needed or stuck.",
		parameters: Type.Object({
			subagentId: Type.String({ description: "ID of the subagent to stop" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			try {
				await manager.stopSubagent(params.subagentId);
				return {
					content: [{ type: "text", text: `Stopped subagent ${params.subagentId}` }],
					details: { subagentId: params.subagentId },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Failed to stop subagent: ${message}` }],
					details: { subagentId: params.subagentId, error: message },
				};
			}
		},

		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("subagent_stop ")) + theme.fg("accent", args.subagentId),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as { subagentId: string; error?: string } | undefined;
			if (details?.error) {
				const text = result.content[0];
				return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
			}
			const text = result.content[0];
			return new Text(theme.fg("success", text?.type === "text" ? text.text : "Stopped"), 0, 0);
		},
	});
}
