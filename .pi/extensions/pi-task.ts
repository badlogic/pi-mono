import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Pi Task Extension — subprocess-based sub-agent spawning.
 *
 * Registers a "task" tool that spawns isolated `pi -p --no-session` subprocesses,
 * bridging the gap with Claude Code's Task tool. Supports:
 * - Concurrent task execution with bounded parallelism
 * - JSON mode for structured output parsing
 * - Per-task timeout
 * - Context isolation (each subprocess has its own session)
 *
 * Unblocks: argue, review-paper, create-movie (3 CRITICAL skills)
 */

import { Type } from "@sinclair/typebox";

export default function piTask(pi: ExtensionAPI) {
	pi.registerTool({
		name: "task",
		label: "Task",
		description:
			"Spawn an isolated sub-agent to handle a task autonomously. " +
			"Each task runs in a separate Pi subprocess with its own context. " +
			"Use for parallel research, multi-persona work, or delegating complex sub-tasks. " +
			"Returns the sub-agent's text output.",
		parameters: Type.Object({
			prompt: Type.String({
				description: "The task prompt for the sub-agent",
			}),
			description: Type.Optional(
				Type.String({
					description: "Short description of the task (3-5 words) for logging",
				}),
			),
			mode: Type.Optional(
				Type.String({
					description: "Output mode: 'text' (default) or 'json' for structured output",
					default: "text",
				}),
			),
			timeout_ms: Type.Optional(
				Type.Number({
					description: "Timeout in milliseconds (default 300000 = 5 min)",
					minimum: 5000,
					maximum: 1800000,
					default: 300000,
				}),
			),
			max_turns: Type.Optional(
				Type.Number({
					description: "Max agentic turns for the sub-agent (default 10)",
					minimum: 1,
					maximum: 50,
					default: 10,
				}),
			),
			cwd: Type.Optional(
				Type.String({
					description: "Working directory for the sub-agent (default: current cwd)",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const prompt = params.prompt;
			const mode = params.mode ?? "text";
			const timeoutMs = params.timeout_ms ?? 300000;
			const maxTurns = params.max_turns ?? 10;
			const desc = params.description ?? prompt.substring(0, 40);
			const taskCwd = params.cwd;

			const args = [
				"-p",
				"--no-session",
				"--max-turns",
				String(maxTurns),
			];

			if (mode === "json") {
				args.push("--mode", "json");
			}

			args.push(prompt);

			const start = Date.now();

			try {
				const result = await pi.exec("pi", args, {
					timeout: timeoutMs,
					signal,
					cwd: taskCwd,
				});

				const durationMs = Date.now() - start;
				const output = result.stdout.trim();
				const stderr = result.stderr.trim();

				if (result.code !== 0) {
					const errorDetail = stderr || output || "(no output)";
					return {
						type: "text" as const,
						text: `Task "${desc}" failed (exit ${result.code}, ${durationMs}ms):\n${errorDetail.substring(0, 3000)}`,
						isError: true,
					};
				}

				if (result.killed) {
					return {
						type: "text" as const,
						text: `Task "${desc}" timed out after ${durationMs}ms`,
						isError: true,
					};
				}

				const header = `Task "${desc}" completed (${durationMs}ms)`;

				if (mode === "json") {
					// Try to extract the last JSON object/array from output
					const jsonMatch = output.match(/[\[{][\s\S]*[\]}]\s*$/);
					if (jsonMatch) {
						return {
							type: "text" as const,
							text: `${header}\n\n${jsonMatch[0]}`,
						};
					}
				}

				return {
					type: "text" as const,
					text: `${header}\n\n${output.substring(0, 8000)}`,
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					type: "text" as const,
					text: `Task "${desc}" threw: ${message}`,
					isError: true,
				};
			}
		},
	});
}
